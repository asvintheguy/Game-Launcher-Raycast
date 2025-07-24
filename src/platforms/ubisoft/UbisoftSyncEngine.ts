// Ubisoft Sync Engine - equivalent to C# UbisoftSyncEngine

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { join } from "path"
import { ISyncEngine, Game } from "../interfaces"

const execAsync = promisify(exec)

interface UbisoftGame {
    id: string
    title: string
    installPath?: string
    iconPath?: string
    uninstallString?: string
}

export class UbisoftSyncEngine implements ISyncEngine {
    public PlatformName = "Ubisoft Connect"
    public SynchronizedGames: Game[] = []

    async SynchronizeGames(): Promise<void> {
        const ubisoftGames = await this.findAllUbisoftGames()
        this.SynchronizedGames = ubisoftGames.map(game => this.mapUbisoftGameToGame(game))
    }

    private async findAllUbisoftGames(): Promise<UbisoftGame[]> {
        try {
            const games: UbisoftGame[] = []
            
            // Ubisoft games are registered in Windows registry under uninstall programs
            const { stdout } = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s')
            
            const allKeys = stdout.split('\n').filter(line => line.includes('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'))
            
            for (const keyLine of allKeys) {
                const keyPath = keyLine.trim()
                if (!keyPath) continue
                
                try {
                    const game = await this.parseUbisoftGameFromRegistry(keyPath)
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

    private async parseUbisoftGameFromRegistry(keyPath: string): Promise<UbisoftGame | null> {
        try {
            // Check if this is a Ubisoft game by looking for "Uplay Install" in the registry key
            const keyId = keyPath.split('\\').pop() || ''
            
            // First check if the key contains Ubisoft-related identifiers
            if (!keyId.includes('Uplay Install') && !keyId.includes('Ubisoft')) {
                // Additional check - query the publisher to see if it's Ubisoft
                try {
                    const publisherQuery = await execAsync(`reg query "${keyPath}" /v Publisher`)
                    const publisherMatch = publisherQuery.stdout.match(/Publisher\s+REG_SZ\s+(.+)/)
                    
                    if (!publisherMatch || !publisherMatch[1].toLowerCase().includes('ubisoft')) {
                        return null
                    }
                } catch {
                    return null
                }
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

            // Extract game ID from the registry key
            let gameId = keyId
            if (keyId.includes('Uplay Install ')) {
                gameId = keyId.replace('Uplay Install ', '')
            }

            return {
                id: gameId,
                title,
                installPath,
                iconPath: this.findGameIcon(installPath),
                uninstallString
            }
        } catch (error) {
            return null
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

    private mapUbisoftGameToGame(ubisoftGame: UbisoftGame): Game {
        return {
            id: `ubisoft-${ubisoftGame.id}`,
            title: ubisoftGame.title,
            platform: this.PlatformName,
            iconPath: ubisoftGame.iconPath,
            launchCommand: `uplay://launch/${ubisoftGame.id}/0`,
            uninstallCommand: ubisoftGame.uninstallString,
            runTask: async () => {
                // Launch game using Ubisoft Connect URI protocol
                const launchUri = `uplay://launch/${ubisoftGame.id}/0`
                await execAsync(`start "" "${launchUri}"`)
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