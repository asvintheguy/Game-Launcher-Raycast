import { existsSync, writeFileSync, readFileSync } from "fs"
import { exec } from "child_process"
import { promisify } from "util"
import { join } from "path"
import { homedir, tmpdir } from "os"
import { Cache } from "@raycast/api"
import { Game, ISyncEngine } from "../interfaces"

const execAsync = promisify(exec)

export interface UWPApp {
    Name: string
    PackageFamilyName: string
    InstallLocation: string
}

export interface XboxAuthCache {
    userHash: string
    xstsToken: string
    xuid: string
}

export class XboxSyncEngine implements ISyncEngine {
    PlatformName = "Xbox"
    SynchronizedGames: Game[] = []
    private cache = new Cache()

    private loadAuthCache(): XboxAuthCache | null {
        try {
            const cacheData = this.cache.get("xbox-auth-tokens")
            if (cacheData) {
                return JSON.parse(cacheData)
            }
        } catch (error) {
            console.warn("Failed to load Xbox auth cache:", error)
        }
        return null
    }

    async SynchronizeGames(): Promise<void> {
        this.SynchronizedGames = []

        try {
            // Get local UWP apps
            const localApps = await this.getUWPApps()
            console.log(`Found ${localApps.length} local UWP apps`)

            // Get owned games from cache (created by Xbox setup command)
            const ownedGames = await this.getOwnedGamesFromCache()
            if (!ownedGames || ownedGames.size === 0) {
                console.log("No owned Xbox games found. Run 'Set up Xbox Games' command first to authenticate and cache your owned games.")
                return
            }

            console.log(`Found ${ownedGames.size} owned Xbox games`)

            // Get cached game details and start apps mapping
            const gameDetails = this.getGameDetailsFromCache()
            const startAppsMap = await this.getStartApps()
            console.log(`Found ${startAppsMap.size} Start Apps for launch command mapping`)

            // Match local apps with owned games
            for (const app of localApps) {
                if (this.isXboxGame(app.PackageFamilyName, ownedGames)) {
                    const details = gameDetails[app.PackageFamilyName]
                    
                    const game: Game = {
                        id: app.PackageFamilyName,
                        title: details?.name || this.cleanGameName(app.Name),
                        platform: this.PlatformName,
                        launchCommand: this.createLaunchCommand(app.PackageFamilyName, startAppsMap),
                        iconPath: details?.displayImage || this.getGameIcon(app.InstallLocation),
                        description: details?.description || "",
                        developers: details?.developerName ? [details.developerName] : undefined,
                        publishers: details?.publisherName ? [details.publisherName] : undefined,
                        genres: details?.genres?.length > 0 ? details.genres : undefined,
                        releaseDate: details?.releaseDate ? new Date(details.releaseDate).toLocaleDateString() : undefined,
                        lastActivity: details?.lastTimePlayed ? new Date(details.lastTimePlayed).toLocaleString() : undefined,
                        source: "Xbox Store"
                    }

                    this.SynchronizedGames.push(game)
                }
            }

            console.log(`Found ${this.SynchronizedGames.length} locally installed Xbox games`)

        } catch (error) {
            console.error("Failed to detect Xbox games:", error)
            // Don't throw error - just return empty list so other platforms still work
        }
    }

    private async getUWPApps(): Promise<UWPApp[]> {
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
            const { stdout } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`
            )

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
                // Clean up temp file
                const fs = require('fs')
                fs.unlinkSync(tmpFile)
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    private async getOwnedGamesFromCache(): Promise<Set<string> | null> {
        try {
            // Try to read from Raycast cache first
            const cacheData = this.cache.get("xbox-owned-games-pfns")
            if (cacheData) {
                const pfns = JSON.parse(cacheData)
                return new Set(pfns)
            }

            // Fallback: Try to read from the debug file created by the detector script
            const debugPath = join(process.cwd(), "debug_owned_xbox_games_pfns.json")
            if (existsSync(debugPath)) {
                const pfns = JSON.parse(readFileSync(debugPath, 'utf8'))
                return new Set(pfns)
            }
        } catch (error) {
            console.warn("Failed to load owned games cache:", error)
        }
        return null
    }

    private getGameDetailsFromCache(): Record<string, any> {
        try {
            const cacheData = this.cache.get("xbox-game-details")
            if (cacheData) {
                return JSON.parse(cacheData)
            }
        } catch (error) {
            console.warn("Failed to load Xbox game details cache:", error)
        }
        return {}
    }

    private isXboxGame(pfn: string, ownedGames: Set<string>): boolean {
        return ownedGames.has(pfn)
    }

    private cleanGameName(packageName: string): string {
        // Clean up package name to be more readable
        let name = packageName
            .replace(/^Microsoft\./, '')
            .replace(/^Xbox\./, '')
            .replace(/Game$/, '')
            .replace(/App$/, '')
            .replace(/\./g, ' ')
            .trim()

        // Capitalize first letter of each word
        return name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ')
    }

    private async getStartApps(): Promise<Map<string, string>> {
        const psScript = `
Get-StartApps | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        AppID = $_.AppID
    }
} | ConvertTo-Json -Compress
`
        const tmpFile = join(tmpdir(), "getStartApps.ps1")
        writeFileSync(tmpFile, psScript, "utf8")

        try {
            const { stdout } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`
            )

            if (!stdout.trim()) {
                return new Map()
            }

            const json = JSON.parse(stdout)
            const apps = Array.isArray(json) ? json : [json]
            const startAppsMap = new Map<string, string>()

            for (const app of apps) {
                // Extract Package Family Name from AppID if it contains one
                if (app.AppID && app.AppID.includes('!')) {
                    const [pfn] = app.AppID.split('!')
                    if (pfn && pfn.includes('_')) {
                        startAppsMap.set(pfn, app.AppID)
                    }
                }
            }

            return startAppsMap
        } catch (error) {
            console.warn("Failed to fetch Start Apps:", error)
            return new Map()
        } finally {
            try {
                const fs = require('fs')
                fs.unlinkSync(tmpFile)
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    private createLaunchCommand(packageFamilyName: string, startAppsMap: Map<string, string>): string {
        // Look up the correct AppID from Start Apps
        const fullAppId = startAppsMap.get(packageFamilyName)
        if (fullAppId) {
            return `shell:AppsFolder\\${fullAppId}`
        }
        
        // Fallback: try to construct it (may not work for all games)
        console.warn(`Could not find AppID for ${packageFamilyName}, using fallback`)
        return `shell:AppsFolder\\${packageFamilyName}!App`
    }

    private getGameIcon(installLocation: string): string | undefined {
        if (!installLocation || !existsSync(installLocation)) {
            return undefined
        }

        // Common icon file names in Xbox games
        const iconFiles = [
            'Square44x44Logo.png',
            'Square150x150Logo.png', 
            'Square310x310Logo.png',
            'StoreLogo.png',
            'ApplicationIcon.png',
            'Icon.png'
        ]

        for (const iconFile of iconFiles) {
            const iconPath = join(installLocation, iconFile)
            if (existsSync(iconPath)) {
                return iconPath
            }

            // Also check in Assets subfolder
            const assetsIconPath = join(installLocation, 'Assets', iconFile)
            if (existsSync(assetsIconPath)) {
                return assetsIconPath
            }
        }

        return undefined
    }
}