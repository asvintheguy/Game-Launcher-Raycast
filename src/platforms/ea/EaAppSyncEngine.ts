// EA App Sync Engine - equivalent to C# EaAppSyncEngine

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { ISyncEngine, Game } from "../interfaces"
import { parseStringPromise } from "xml2js"

const execAsync = promisify(exec)

interface EaGame {
    id: string
    title: string
    installPath?: string
    iconPath?: string
    uninstallString?: string
    executablePath?: string
}

interface InstallerDataXml {
    DiPManifest?: {
        runtime?: [{
            launcher?: [{
                filePath?: [string]
                trial?: [string]
            }]
        }]
    }
}

export class EaAppSyncEngine implements ISyncEngine {
    public PlatformName = "EA app"
    public SynchronizedGames: Game[] = []

    async SynchronizeGames(): Promise<void> {
        const eaGames = await this.findAllEaGames()
        this.SynchronizedGames = eaGames.map(game => this.mapEaGameToGame(game))
    }

    private async findAllEaGames(): Promise<EaGame[]> {
        try {
            const games: EaGame[] = []
            
            // EA games are registered in Windows registry under uninstall programs
            const { stdout } = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s')
            
            const allKeys = stdout.split('\n').filter(line => line.includes('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'))
            
            for (const keyLine of allKeys) {
                const keyPath = keyLine.trim()
                if (!keyPath) continue
                
                try {
                    const game = await this.parseEaGameFromRegistry(keyPath)
                    if (game) {
                        games.push(game)
                    }
                } catch (error) {
                    // Skip games that can't be parsed
                    continue
                }
            }
            
            return games
        } catch (error) {
            return []
        }
    }

    private async parseEaGameFromRegistry(keyPath: string): Promise<EaGame | null> {
        try {
            // Check if this is an EA game by looking for EA-related identifiers
            const keyId = keyPath.split('\\').pop() || ''
            
            // Check publisher to see if it's EA
            let isEaGame = false
            try {
                const publisherQuery = await execAsync(`reg query "${keyPath}" /v Publisher`)
                const publisherMatch = publisherQuery.stdout.match(/Publisher\s+REG_SZ\s+(.+)/)
                
                if (publisherMatch) {
                    const publisher = publisherMatch[1].toLowerCase()
                    isEaGame = publisher.includes('electronic arts') || 
                              publisher.includes('ea games') || 
                              publisher.includes('ea sports') ||
                              publisher.includes('ea ')
                }
            } catch {
                // If no publisher, check if key contains EA identifiers
                isEaGame = keyId.toLowerCase().includes('ea') || keyId.toLowerCase().includes('origin')
            }

            if (!isEaGame) {
                return null
            }

            // Get display name
            const nameQuery = await execAsync(`reg query "${keyPath}" /v DisplayName`)
            const nameMatch = nameQuery.stdout.match(/DisplayName\s+REG_SZ\s+(.+)/)
            
            if (!nameMatch) {
                return null
            }

            const title = nameMatch[1].trim()
            
            // Get install location
            let installPath: string | undefined
            try {
                const pathQuery = await execAsync(`reg query "${keyPath}" /v InstallLocation`)
                const pathMatch = pathQuery.stdout.match(/InstallLocation\s+REG_SZ\s+(.+)/)
                if (pathMatch) {
                    installPath = pathMatch[1].trim()
                }
            } catch {
                // Install location is optional
            }

            // Get uninstall string
            let uninstallString: string | undefined
            try {
                const uninstallQuery = await execAsync(`reg query "${keyPath}" /v UninstallString`)
                const uninstallMatch = uninstallQuery.stdout.match(/UninstallString\s+REG_SZ\s+(.+)/)
                if (uninstallMatch) {
                    uninstallString = uninstallMatch[1].trim()
                }
            } catch {
                // Uninstall string is optional
            }

            // Get icon path
            let iconPath: string | undefined
            try {
                const iconQuery = await execAsync(`reg query "${keyPath}" /v DisplayIcon`)
                const iconMatch = iconQuery.stdout.match(/DisplayIcon\s+REG_SZ\s+(.+)/)
                if (iconMatch) {
                    iconPath = iconMatch[1].trim()
                }
            } catch {
                // Icon path is optional
            }

            // Try to find executable path
            const executablePath = await this.findExecutablePath(installPath, uninstallString)

            return {
                id: keyId,
                title,
                installPath,
                iconPath: iconPath || this.findGameIcon(installPath),
                uninstallString,
                executablePath
            }
        } catch (error) {
            return null
        }
    }

    private async findExecutablePath(installPath?: string, uninstallString?: string): Promise<string | undefined> {
        // Try to get executable path from installer data XML
        if (installPath) {
            const xmlPath = join(installPath, "__Installer", "installerdata.xml")
            if (existsSync(xmlPath)) {
                const execPath = await this.getGameExePathFromInstallerData(xmlPath)
                if (execPath) {
                    return execPath
                }
            }
        }

        // Try to get executable path from uninstall program
        if (uninstallString) {
            return this.getGameExePathFromUninstallProgram(uninstallString)
        }

        return undefined
    }

    private async getGameExePathFromInstallerData(xmlPath: string): Promise<string | undefined> {
        try {
            const xmlContent = readFileSync(xmlPath, 'utf8')
            const result = await parseStringPromise(xmlContent) as InstallerDataXml

            const launchers = result.DiPManifest?.runtime?.[0]?.launcher
            if (!launchers || launchers.length === 0) {
                return undefined
            }

            // Find the first non-trial launcher
            for (const launcher of launchers) {
                const trial = launcher.trial?.[0]?.toLowerCase() === 'true'
                if (!trial && launcher.filePath?.[0]) {
                    const exePath = join(dirname(xmlPath), launcher.filePath[0])
                    if (existsSync(exePath)) {
                        return exePath
                    }
                }
            }

            return undefined
        } catch (error) {
            return undefined
        }
    }

    private getGameExePathFromUninstallProgram(uninstallString: string): string | undefined {
        try {
            // Extract path from uninstall string - look for exe files
            const exeMatch = uninstallString.match(/([^"]*\.exe)/i)
            if (exeMatch) {
                const exePath = exeMatch[1]
                if (existsSync(exePath)) {
                    return exePath
                }
            }

            return undefined
        } catch (error) {
            return undefined
        }
    }

    private findGameIcon(installPath?: string): string | undefined {
        if (!installPath || !existsSync(installPath)) {
            return undefined
        }

        const commonIconPaths = [
            join(installPath, "game.ico"),
            join(installPath, "icon.ico"),
            join(installPath, "game.png"),
            join(installPath, "icon.png"),
            join(installPath, "launcher.ico"),
            join(installPath, "app.ico")
        ]

        for (const iconPath of commonIconPaths) {
            if (existsSync(iconPath)) {
                return iconPath
            }
        }

        return undefined
    }

    private mapEaGameToGame(eaGame: EaGame): Game {
        return {
            id: `ea-${eaGame.id}`,
            title: eaGame.title,
            platform: this.PlatformName,
            iconPath: eaGame.iconPath,
            launchCommand: eaGame.executablePath || `"${eaGame.executablePath}"`,
            uninstallCommand: eaGame.uninstallString,
            runTask: async () => {
                if (eaGame.executablePath && existsSync(eaGame.executablePath)) {
                    // Launch game directly
                    await execAsync(`"${eaGame.executablePath}"`)
                } else {
                    // Try to launch via EA app if available
                    try {
                        await execAsync(`start "" "ea://launch/${eaGame.id}"`)
                    } catch {
                        // Fallback to opening EA app
                        await execAsync(`start "" "ea://"`);
                    }
                }
            }
        }
    }

    async uninstallGame(gameId: string): Promise<void> {
        const game = this.SynchronizedGames.find(g => g.id === gameId)
        if (!game || !game.uninstallCommand) {
            throw new Error(`Game with ID ${gameId} not found or cannot be uninstalled`)
        }

        try {
            // Execute uninstall command
            await execAsync(game.uninstallCommand)
            
            // Wait a bit for the uninstall to process
            await new Promise(resolve => setTimeout(resolve, 2000))
            
            // Re-synchronize games to update the list
            await this.SynchronizeGames()
        } catch (error) {
            throw new Error(`Failed to uninstall game: ${error}`)
        }
    }
}