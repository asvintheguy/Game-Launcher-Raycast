import { Action, ActionPanel, List, showToast, Toast, getPreferenceValues, Icon, Detail } from "@raycast/api"
import { Preferences } from "./platforms/interfaces"
import { useCachedPromise } from "@raycast/utils"
import { useState } from "react"
import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, mkdirSync, createWriteStream, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createHash } from "crypto"

const execAsync = promisify(exec)
const preferences: Preferences = getPreferenceValues()

interface ReleaseAsset {
    name: string
    download_url: string
    size: number
}

interface GitHubRelease {
    tag_name: string
    name: string
    body: string
    assets: ReleaseAsset[]
    published_at: string
}

interface InstallationStatus {
    isInstalled: boolean
    version?: string
    pluginPath?: string
    libraryJsonPath?: string
}

function getPlayniteDataPath(): string {
    if (preferences?.playniteDataPath && existsSync(preferences.playniteDataPath)) {
        return preferences.playniteDataPath
    }
    
    const appdata = process.env.APPDATA
    if (!appdata) {
        throw new Error("APPDATA environment variable not found")
    }
    return join(appdata, "Playnite")
}

function getPlaynitePluginPath(): string {
    return join(getPlayniteDataPath(), "Extensions")
}

function getRaycastLibraryPath(): string {
    return join(homedir(), "Documents", "playnite-raycast-library.json")
}

async function checkInstallationStatus(): Promise<InstallationStatus> {
    try {
        const pluginPath = getPlaynitePluginPath()
        const raycastPluginPath = join(pluginPath, "RaycastExport") // Assuming plugin folder name
        const libraryJsonPath = getRaycastLibraryPath()
        
        const isPluginInstalled = existsSync(raycastPluginPath)
        const isLibraryFilePresent = existsSync(libraryJsonPath)
        
        return {
            isInstalled: isPluginInstalled && isLibraryFilePresent,
            pluginPath: isPluginInstalled ? raycastPluginPath : undefined,
            libraryJsonPath: isLibraryFilePresent ? libraryJsonPath : undefined,
        }
    } catch (error) {
        return { isInstalled: false }
    }
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
    const response = await fetch("https://api.github.com/repos/yourusername/playnite-raycast-plugin/releases/latest")
    if (!response.ok) {
        throw new Error(`Failed to fetch release: ${response.statusText}`)
    }
    return await response.json()
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`)
    }
    
    const fileStream = createWriteStream(outputPath)
    const reader = response.body?.getReader()
    
    if (!reader) {
        throw new Error("Failed to get response reader")
    }
    
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fileStream.write(value)
    }
    
    fileStream.end()
}

async function verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
    try {
        const fileBuffer = readFileSync(filePath)
        const hash = createHash('sha256').update(fileBuffer).digest('hex')
        return hash === expectedHash
    } catch (error) {
        return false
    }
}

async function killPlayniteProcesses(): Promise<void> {
    await showToast({
        style: Toast.Style.Animated,
        title: "Stopping Playnite...",
        message: "Killing running Playnite processes"
    })

    // Kill Playnite processes if they're running
    const processNames = ["Playnite.DesktopApp.exe", "Playnite.FullscreenApp.exe"]
    
    for (const processName of processNames) {
        try {
            await execAsync(`taskkill /F /IM "${processName}"`)
            console.log(`Killed ${processName}`)
        } catch (error) {
            // Process might not be running, which is fine
            console.log(`${processName} was not running or already stopped`)
        }
    }

    // Wait a moment for processes to fully terminate
    await new Promise(resolve => setTimeout(resolve, 2000))
}

async function startPlaynite(mode: "normal" | "minimized" | "hidden" | "with-args" | "vbscript" = "hidden"): Promise<void> {
    const playniteDataPath = getPlayniteDataPath()
    const playniteExePath = join(playniteDataPath, "Playnite.DesktopApp.exe")
    
    if (!existsSync(playniteExePath)) {
        throw new Error(`Playnite executable not found at: ${playniteExePath}`)
    }

    let command: string
    let message: string

    switch (mode) {
        case "normal":
            command = `start "" "${playniteExePath}"`
            message = "Launching Playnite normally"
            break
        
        case "minimized":
            command = `powershell -Command "Start-Process '${playniteExePath}' -WindowStyle Minimized"`
            message = "Launching Playnite minimized to taskbar"
            break
        
        case "hidden":
            command = `powershell -Command "Start-Process '${playniteExePath}' -WindowStyle Hidden"`
            message = "Launching Playnite hidden in background"
            break
        
        case "with-args":
            // Try multiple common background/minimized arguments
            command = `start "" "${playniteExePath}" --minimized --silent --background`
            message = "Launching Playnite with background arguments"
            break
        
        case "vbscript":
            // Create a temporary VBScript to launch without window
            const tempDir = require('os').tmpdir()
            const vbsPath = join(tempDir, 'launch_playnite.vbs')
            const vbsContent = `CreateObject("Wscript.Shell").Run """${playniteExePath}""", 0`
            require('fs').writeFileSync(vbsPath, vbsContent)
            command = `cscript //nologo "${vbsPath}"`
            message = "Launching Playnite via VBScript (no window)"
            break
    }

    await showToast({
        style: Toast.Style.Animated,
        title: "Starting Playnite...",
        message: message
    })

    try {
        await execAsync(command)
        
        await showToast({
            style: Toast.Style.Success,
            title: "Playnite restarted!",
            message: `${message} - check system tray`
        })
    } catch (error) {
        await showToast({
            style: Toast.Style.Failure,
            title: "Start failed",
            message: `Failed with ${mode} mode: ${error instanceof Error ? error.message : "Unknown error"}`
        })
        throw error
    }
}

async function installPlugin(release: GitHubRelease): Promise<void> {
    // DEBUGGING: Skip download/extract steps for now
    /*
    // Find the plugin ZIP asset
    const pluginAsset = release.assets.find(asset => asset.name.endsWith('.zip'))
    if (!pluginAsset) {
        throw new Error("No plugin ZIP file found in release")
    }
    
    const tempDir = join(require('os').tmpdir(), 'raycast-playnite-setup')
    const downloadPath = join(tempDir, pluginAsset.name)
    
    // Create temp directory
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
    }
    
    await showToast({
        style: Toast.Style.Animated,
        title: "Downloading plugin...",
        message: `Downloading ${pluginAsset.name}`
    })
    
    // Download the ZIP file
    await downloadFile(pluginAsset.download_url, downloadPath)
    
    // TODO: Add hash verification if you include hashes in your release
    // const isValid = await verifyFileHash(downloadPath, expectedHash)
    // if (!isValid) {
    //     throw new Error("File hash verification failed")
    // }
    
    await showToast({
        style: Toast.Style.Animated,
        title: "Extracting plugin...",
        message: "Installing to Playnite Extensions folder"
    })
    
    // Extract to Playnite Extensions directory
    const pluginDir = getPlaynitePluginPath()
    if (!existsSync(pluginDir)) {
        mkdirSync(pluginDir, { recursive: true })
    }
    
    // Use PowerShell to extract ZIP (cross-platform alternative would be to use a ZIP library)
    await execAsync(`powershell -Command "Expand-Archive -Path '${downloadPath}' -DestinationPath '${pluginDir}' -Force"`)
    */
    
    // DEBUGGING: Test restart process  
    await killPlayniteProcesses()
    await startPlaynite("normal") // Just use normal start - reliable
}

export default function Command() {
    const [selectedAction, setSelectedAction] = useState<string | null>(null)
    const { data: status, isLoading: statusLoading, revalidate: revalidateStatus } = useCachedPromise(checkInstallationStatus)
    const { data: release, isLoading: releaseLoading } = useCachedPromise(fetchLatestRelease)
    
    if (selectedAction === "install" && release) {
        return (
            <Detail
                markdown={`# Installing Playnite Integration Plugin

## Release: ${release.name}
**Version:** ${release.tag_name}
**Published:** ${new Date(release.published_at).toLocaleDateString()}

## What this will do:
1. Download the plugin ZIP from GitHub
2. Extract it to your Playnite Extensions folder
3. Set up the library export functionality

## Next steps after installation:
1. Restart Playnite
2. The plugin will automatically export your game library to \`${getRaycastLibraryPath()}\`
3. Use the main "Launch A Game" command to see your games

${release.body}
`}
                actions={
                    <ActionPanel>
                        <Action
                            title="Install Plugin"
                            icon={Icon.Download}
                            onAction={async () => {
                                try {
                                    await installPlugin(release)
                                    await revalidateStatus()
                                    setSelectedAction(null)
                                } catch (error) {
                                    await showToast({
                                        style: Toast.Style.Failure,
                                        title: "Installation failed",
                                        message: error instanceof Error ? error.message : "Unknown error"
                                    })
                                }
                            }}
                        />
                        <Action
                            title="Cancel"
                            icon={Icon.XMarkCircle}
                            onAction={() => setSelectedAction(null)}
                        />
                    </ActionPanel>
                }
            />
        )
    }
    
    return (
        <List isLoading={statusLoading || releaseLoading}>
            <List.Item
                title="Installation Status"
                subtitle={status?.isInstalled ? "Plugin is installed" : "Plugin not installed"}
                icon={status?.isInstalled ? Icon.CheckCircle : Icon.XMarkCircle}
                accessories={[{ text: status?.isInstalled ? "Ready" : "Setup Required" }]}
                actions={
                    <ActionPanel>
                        {!status?.isInstalled && release && (
                            <Action
                                title="Install Plugin"
                                icon={Icon.Download}
                                onAction={() => setSelectedAction("install")}
                            />
                        )}
                        <Action
                            title="Refresh Status"
                            icon={Icon.ArrowClockwise}
                            onAction={revalidateStatus}
                            shortcut={{
                                macOS: { modifiers: ["cmd"], key: "r" },
                                windows: { modifiers: ["ctrl"], key: "r" },
                            }}
                        />
                    </ActionPanel>
                }
            />
            
            {release && (
                <List.Item
                    title={`Latest Release: ${release.name}`}
                    subtitle={`Version ${release.tag_name} • ${new Date(release.published_at).toLocaleDateString()}`}
                    icon={Icon.Download}
                    accessories={[{ text: `${release.assets.length} assets` }]}
                />
            )}
            
            <List.Item
                title="Plugin Location"
                subtitle={getPlaynitePluginPath()}
                icon={Icon.Folder}
                accessories={[{ text: existsSync(getPlaynitePluginPath()) ? "Exists" : "Missing" }]}
            />
            
            <List.Item
                title="Library Export Location"
                subtitle={getRaycastLibraryPath()}
                icon={Icon.Document}
                accessories={[{ text: existsSync(getRaycastLibraryPath()) ? "Exists" : "Missing" }]}
            />
        </List>
    )
}