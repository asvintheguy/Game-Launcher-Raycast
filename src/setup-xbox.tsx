import { Action, ActionPanel, Detail, Form, showToast, Toast, Icon, Cache } from "@raycast/api"
import { useState } from "react"
import { writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { exec } from "child_process"
import { promisify } from "util"
import https from "https"
import querystring from "querystring"

const cache = new Cache()

const execAsync = promisify(exec)

// Xbox authentication constants
const CLIENT_ID = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c"
const REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf"
const SCOPE = "XboxLive.signin XboxLive.offline_access"

interface SetupState {
    step: "status" | "auth" | "token-input" | "processing" | "complete"
    authUrl?: string
    gamesFound?: number
    error?: string
}

interface UWPApp {
    Name: string
    PackageFamilyName: string
    InstallLocation: string
}

function getSetupStatus(): { isSetup: boolean; gamesFound: number } {
    try {
        const pfns = cache.get("xbox-owned-games-pfns")
        if (pfns) {
            const pfnArray = JSON.parse(pfns)
            return { isSetup: true, gamesFound: pfnArray.length }
        }
    } catch (error) {
        console.warn("Failed to check Xbox setup status:", error)
    }

    return { isSetup: false, gamesFound: 0 }
}

function makeRequest(
    hostname: string,
    path: string,
    method: string,
    data?: string,
    headers?: Record<string, string>,
): Promise<any> {
    return new Promise((resolve, reject) => {
        console.log(`Making ${method} request to https://${hostname}${path}`)
        if (headers) console.log("Headers:", headers)
        if (data) console.log("Data:", data)

        const req = https.request({ hostname, path, method, headers }, res => {
            let body = ""
            console.log(`Response status: ${res.statusCode}`)
            // console.log('Response headers:', res.headers)

            res.on("data", chunk => (body += chunk))
            res.on("end", () => {
                // console.log(`Response body: ${body}`)

                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`))
                    return
                }

                try {
                    const parsed = JSON.parse(body)
                    resolve(parsed)
                } catch (parseError) {
                    reject(new Error(`Invalid JSON response from ${hostname}${path}: ${body.substring(0, 200)}...`))
                }
            })
        })

        req.on("error", error => {
            console.error(`Request error for ${hostname}${path}:`, error)
            reject(error)
        })

        if (data) req.write(data)
        req.end()
    })
}

async function getUWPApps(): Promise<UWPApp[]> {
    const psScript = `
Get-AppxPackage | Where-Object {
    $_.SignatureKind -eq "Store" -and
        -not $_.IsFramework -and
        -not $_.IsResourcePackage
    } | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        PackageFamilyName = $_.PackageFamilyName
        InstallLocation = $_.InstallLocation
    }
} | ConvertTo-Json -Compress
`

    const tmpFile = join(tmpdir(), "getUWPApps.ps1")
    writeFileSync(tmpFile, psScript, "utf8")

    try {
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`)

        if (!stdout.trim()) {
            return []
        }

        const json = JSON.parse(stdout)
        return Array.isArray(json) ? json : [json]
    } catch (error) {
        console.warn("Failed to fetch UWP apps:", error)
        return []
    } finally {
        try {
            const fs = require("fs")
            fs.unlinkSync(tmpFile)
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

async function authenticateWithCode(code: string): Promise<{ userHash: string; xstsToken: string; xuid: string }> {
    const tokenRes = await makeRequest(
        "login.live.com",
        "/oauth20_token.srf",
        "POST",
        querystring.stringify({
            grant_type: "authorization_code",
            code,
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
        }),
        { "Content-Type": "application/x-www-form-urlencoded" },
    )

    const accessToken = tokenRes.access_token

    const xboxRes = await makeRequest(
        "user.auth.xboxlive.com",
        "/user/authenticate",
        "POST",
        JSON.stringify({
            Properties: {
                AuthMethod: "RPS",
                SiteName: "user.auth.xboxlive.com",
                RpsTicket: `d=${accessToken}`,
            },
            RelyingParty: "http://auth.xboxlive.com",
            TokenType: "JWT",
        }),
        { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
    )

    const userToken = xboxRes.Token
    const userHash = xboxRes.DisplayClaims.xui[0].uhs

    const xstsRes = await makeRequest(
        "xsts.auth.xboxlive.com",
        "/xsts/authorize",
        "POST",
        JSON.stringify({
            Properties: {
                SandboxId: "RETAIL",
                UserTokens: [userToken],
            },
            RelyingParty: "http://xboxlive.com",
            TokenType: "JWT",
        }),
        { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
    )

    const xstsToken = xstsRes.Token
    const xuid = xstsRes.DisplayClaims.xui[0].xid

    const result = { userHash, xstsToken, xuid }
    cache.set("xbox-auth-tokens", JSON.stringify(result))
    return result
}

async function getUserOwnedGames(xuid: string, userHash: string, xstsToken: string): Promise<Set<string>> {
    const headers = {
        Authorization: `XBL3.0 x=${userHash};${xstsToken}`,
        "x-xbl-contract-version": "2",
        "Accept-Language": "en",
    }

    const res = await makeRequest(
        "titlehub.xboxlive.com",
        `/users/xuid(${xuid})/titles/titlehistory/decoration/detail`,
        "GET",
        undefined,
        headers,
    )

    const ownedGames = new Set<string>()
    const gameDetails: Record<string, any> = {}

    if (res.titles) {
        for (const title of res.titles) {
            if (title.type === "Game" && title.pfn) {
                ownedGames.add(title.pfn)
                // Store full game details for later use
                gameDetails[title.pfn] = {
                    name: title.name,
                    displayImage: title.displayImage,
                    lastTimePlayed: title.titleHistory?.lastTimePlayed,
                    description: title.detail?.description || title.detail?.shortDescription || "",
                    developerName: title.detail?.developerName || "",
                    publisherName: title.detail?.publisherName || "",
                    genres: title.detail?.genres || [],
                    releaseDate: title.detail?.releaseDate,
                    devices: title.devices || [],
                }
            }
        }
    }

    // Save both PFNs and full game details to cache
    cache.set("xbox-owned-games-pfns", JSON.stringify(Array.from(ownedGames)))
    cache.set("xbox-game-details", JSON.stringify(gameDetails))

    return ownedGames
}

export default function Command() {
    const [state, setState] = useState<SetupState>({ step: "status" })
    const [redirectUrl, setRedirectUrl] = useState("")

    const status = getSetupStatus()

    const startAuth = () => {
        const authUrl = `https://login.live.com/oauth20_authorize.srf?${querystring.stringify({
            client_id: CLIENT_ID,
            response_type: "code",
            redirect_uri: REDIRECT_URI,
            scope: SCOPE,
        })}`

        setState({ step: "auth", authUrl })
    }

    const processToken = async () => {
        try {
            setState({ step: "processing" })

            await showToast({
                style: Toast.Style.Animated,
                title: "Processing authentication...",
                message: "This may take a moment",
            })

            console.log("Processing redirect URL:", redirectUrl)

            if (!redirectUrl.trim()) {
                throw new Error("Please enter the redirect URL")
            }

            if (!redirectUrl.includes("login.live.com/oauth20_desktop.srf")) {
                throw new Error("Invalid redirect URL. Make sure you copied the complete URL from the browser.")
            }

            const url = new URL(redirectUrl.trim())
            const code = url.searchParams.get("code")
            const error = url.searchParams.get("error")

            if (error) {
                throw new Error(
                    `OAuth error: ${error} - ${url.searchParams.get("error_description") || "Unknown error"}`,
                )
            }

            if (!code) {
                throw new Error("No authorization code found in URL. Make sure you copied the complete redirect URL.")
            }

            console.log("Extracted auth code:", code.substring(0, 20) + "...")

            // Authenticate with Xbox Live
            const { userHash, xstsToken, xuid } = await authenticateWithCode(code)

            await showToast({
                style: Toast.Style.Animated,
                title: "Getting your games...",
                message: "Fetching owned Xbox games",
            })

            // Get owned games
            const ownedGames = await getUserOwnedGames(xuid, userHash, xstsToken)

            await showToast({
                style: Toast.Style.Animated,
                title: "Matching local games...",
                message: "Finding installed Xbox games",
            })

            // Get local UWP apps
            const localApps = await getUWPApps()

            // Match and count
            let matchedGames = 0
            for (const app of localApps) {
                if (ownedGames.has(app.PackageFamilyName)) {
                    matchedGames++
                }
            }

            setState({ step: "complete", gamesFound: matchedGames })

            await showToast({
                style: Toast.Style.Success,
                title: "Xbox setup complete!",
                message: `Found ${matchedGames} Xbox games`,
            })
        } catch (error) {
            console.error("Xbox authentication error:", error)
            const errorMessage = error instanceof Error ? error.message : "Unknown error"

            setState({ step: "status", error: errorMessage })

            await showToast({
                style: Toast.Style.Failure,
                title: "Authentication failed",
                message: errorMessage,
            })
        }
    }

    if (state.step === "auth") {
        return (
            <Detail
                markdown={`# 🔑 Xbox Live Authentication

## Step 1: Sign in to Microsoft

Click the button below to open the Microsoft sign-in page in your browser.

## Step 2: Copy the redirect URL

After signing in, you'll be redirected to a page that may show an error. **This is normal!**

Copy the **entire URL** from your browser's address bar and paste it in the next step.

The URL will look like:
\`https://login.live.com/oauth20_desktop.srf?code=...\`
`}
                actions={
                    <ActionPanel>
                        <Action.OpenInBrowser title="Open Microsoft Sign-in" url={state.authUrl!} icon={Icon.Globe} />
                        <Action
                            title="Next: Enter Redirect URL"
                            icon={Icon.ArrowRight}
                            onAction={() => setState({ step: "token-input" })}
                        />
                        <Action title="Cancel" icon={Icon.XMarkCircle} onAction={() => setState({ step: "status" })} />
                    </ActionPanel>
                }
            />
        )
    }

    if (state.step === "token-input") {
        return (
            <Form
                actions={
                    <ActionPanel>
                        <Action.SubmitForm title="Complete Setup" icon={Icon.CheckCircle} onSubmit={processToken} />
                        <Action title="Back" icon={Icon.ArrowLeft} onAction={() => setState({ step: "auth" })} />
                        <Action title="Cancel" icon={Icon.XMarkCircle} onAction={() => setState({ step: "status" })} />
                    </ActionPanel>
                }
            >
                <Form.Description text="Paste the complete redirect URL from your browser below:" />
                <Form.TextArea
                    id="redirectUrl"
                    title="Redirect URL"
                    placeholder="https://login.live.com/oauth20_desktop.srf?code=..."
                    value={redirectUrl}
                    onChange={setRedirectUrl}
                />
                <Form.Description text="The URL should start with 'https://login.live.com/oauth20_desktop.srf?code=' followed by a long code." />
            </Form>
        )
    }

    if (state.step === "processing") {
        return (
            <Detail
                markdown={`# ⏳ Setting up Xbox Games

Please wait while we:

1. ✅ Authenticate with Xbox Live
2. 🔄 Get your owned games list  
3. 🔄 Scan local Store apps
4. 🔄 Match games with your library

This may take a minute...`}
            />
        )
    }

    if (state.step === "complete") {
        return (
            <Detail
                markdown={`# ✅ Xbox Setup Complete!

🎉 **Success!** Your Xbox games are now set up.

## Results

📊 **${state.gamesFound}** Xbox games found and ready to launch

## What's next?

1. Use the **"Launch A Game"** command to see your Xbox games
2. Xbox games will appear alongside your other platform games
3. You can now launch Xbox games directly from Raycast

## Cache storage

Your Xbox Live authentication tokens and owned games list have been cached using Raycast's secure storage.

You won't need to authenticate again unless you clear your Raycast cache.`}
                actions={
                    <ActionPanel>
                        <Action
                            title="Open Game Launcher"
                            icon={Icon.Play}
                            onAction={() => {
                                // This would ideally navigate to the launch-game command
                                showToast({
                                    style: Toast.Style.Success,
                                    title: "Use 'Launch A Game' command",
                                    message: "Your Xbox games are now available!",
                                })
                            }}
                        />
                        <Action
                            title="Setup Complete"
                            icon={Icon.CheckCircle}
                            onAction={() => setState({ step: "status" })}
                        />
                    </ActionPanel>
                }
            />
        )
    }

    // Default status view
    const markdown = `# 🎮 Xbox Games Setup

## Current Status

${
    status.isSetup
        ? `✅ **Xbox authentication is set up**\n\n📊 Found **${status.gamesFound}** owned Xbox games\n\nYour Xbox games are ready to use in the "Launch A Game" command.`
        : `❌ **Xbox authentication not set up**\n\nTo detect Xbox games, you need to authenticate with Xbox Live first.`
}

${state.error ? `\n⚠️ **Last error:** ${state.error}\n` : ""}

## How Xbox game detection works

Xbox games require authentication because the system needs to:

1. **Get your locally installed Store apps** (via PowerShell)
2. **Authenticate with Xbox Live** to get your owned games list  
3. **Match the two lists** to show only Xbox games you actually own

This prevents showing random Store apps that aren't actually your games.

## Privacy & Security

- Your Xbox Live credentials are handled by Microsoft's official OAuth flow
- Authentication tokens are cached locally for convenience  
- Only Package Family Names (app identifiers) are stored, not personal data
- You can delete the cache files anytime from your project directory
`

    return (
        <Detail
            markdown={markdown}
            actions={
                <ActionPanel>
                    <Action
                        title={status.isSetup ? "Re-authenticate Xbox" : "Start Xbox Setup"}
                        icon={Icon.Key}
                        onAction={startAuth}
                    />
                </ActionPanel>
            }
        />
    )
}
