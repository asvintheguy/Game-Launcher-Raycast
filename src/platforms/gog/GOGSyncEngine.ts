// GOG Sync Engine - equivalent to C# GOGSyncEngine

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { join } from "path"
import { closeMainWindow } from "@raycast/api"
import { ISyncEngine, Game } from "../interfaces"

const execAsync = promisify(exec)

interface GOGGame {
    id: string
    name: string
    path: string
    buildId?: string
    iconPath?: string
}

interface GOGGalaxyClient {
    exePath: string
    iconPath: string
}

export class GOGSyncEngine implements ISyncEngine {
    public PlatformName = "GOG Galaxy"
    public SynchronizedGames: Game[] = []

    async SynchronizeGames(): Promise<void> {
        const gogClient = await this.getGOGGalaxyClient()
        if (!gogClient) {
            this.SynchronizedGames = []
            return
        }

        const gogGames = await this.findAllGOGGames()
        this.SynchronizedGames = gogGames.map(game => this.mapGOGGameToGame(game, gogClient))
    }

    private async getGOGGalaxyClient(): Promise<GOGGalaxyClient | null> {
        try {
            // Check common installation paths for GOG Galaxy
            const commonPaths = [
                process.env.PROGRAMFILES + "\\GOG Galaxy\\GalaxyClient.exe",
                process.env["PROGRAMFILES(X86)"] + "\\GOG Galaxy\\GalaxyClient.exe",
                process.env.LOCALAPPDATA + "\\GOG.com\\Galaxy\\GalaxyClient.exe"
            ]

            for (const path of commonPaths) {
                if (path && existsSync(path)) {
                    return {
                        exePath: path,
                        iconPath: join(path, "..", "Icons", "default.ico")
                    }
                }
            }

            // Try to find GOG Galaxy through registry
            const { stdout } = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /f "GOG GALAXY" /s')
            const galaxyEntries = stdout.split('\n').filter(line => line.includes('GOG GALAXY'))
            
            if (galaxyEntries.length > 0) {
                const keyPath = galaxyEntries[0].trim()
                const installLocationQuery = await execAsync(`reg query "${keyPath}" /v InstallLocation`)
                const installMatch = installLocationQuery.stdout.match(/InstallLocation\s+REG_SZ\s+(.+)/)
                
                if (installMatch) {
                    const installPath = installMatch[1].trim()
                    const exePath = join(installPath, "GalaxyClient.exe")
                    
                    if (existsSync(exePath)) {
                        return {
                            exePath,
                            iconPath: join(installPath, "Icons", "default.ico")
                        }
                    }
                }
            }

            return null
        } catch (error) {
            return null
        }
    }

    private async findAllGOGGames(): Promise<GOGGame[]> {
        try {
            const games: GOGGame[] = []
            
            // GOG games are registered in the GOG-specific registry location
            const { stdout } = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\GOG.com\\Games" /s')
            
            const gameKeys = stdout.split('\n').filter(line => line.includes('HKEY_LOCAL_MACHINE\\SOFTWARE\\GOG.com\\Games\\'))
            
            for (const keyLine of gameKeys) {
                const keyPath = keyLine.trim()
                if (!keyPath) continue
                
                try {
                    const game = await this.parseGameFromRegistry(keyPath)
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

    private async parseGameFromRegistry(keyPath: string): Promise<GOGGame | null> {
        try {
            const gameId = keyPath.split('\\').pop() || ''
            
            // Get game name
            const nameQuery = await execAsync(`reg query "${keyPath}" /v gameName`)
            const nameMatch = nameQuery.stdout.match(/gameName\s+REG_SZ\s+(.+)/)
            
            // Get game path
            const pathQuery = await execAsync(`reg query "${keyPath}" /v path`)
            const pathMatch = pathQuery.stdout.match(/path\s+REG_SZ\s+(.+)/)
            
            if (!nameMatch || !pathMatch) {
                return null
            }

            const gameName = nameMatch[1].trim()
            const gamePath = pathMatch[1].trim()
            
            // Verify game path exists
            if (!existsSync(gamePath)) {
                return null
            }

            // Try to get build ID
            let buildId: string | undefined
            try {
                const buildQuery = await execAsync(`reg query "${keyPath}" /v buildId`)
                const buildMatch = buildQuery.stdout.match(/buildId\s+REG_SZ\s+(.+)/)
                if (buildMatch) {
                    buildId = buildMatch[1].trim()
                }
            } catch {
                // Build ID is optional
            }

            return {
                id: gameId,
                name: gameName,
                path: gamePath,
                buildId,
                iconPath: this.findGameIcon(gamePath)
            }
        } catch (error) {
            return null
        }
    }

    private findGameIcon(gamePath: string): string | undefined {
        const commonIconPaths = [
            join(gamePath, "goggame.ico"),
            join(gamePath, "game.ico"),
            join(gamePath, "icon.ico"),
            join(gamePath, "game.png"),
            join(gamePath, "icon.png")
        ]

        for (const iconPath of commonIconPaths) {
            if (existsSync(iconPath)) {
                return iconPath
            }
        }

        return undefined
    }

    private mapGOGGameToGame(gogGame: GOGGame, gogClient: GOGGalaxyClient): Game {
        return {
            id: `gog-${gogGame.id}`,
            title: gogGame.name,
            platform: this.PlatformName,
            iconPath: gogGame.iconPath,
            launchCommand: `/command=runGame /gameId=${gogGame.id} /path="${gogGame.path}"`,
            uninstallCommand: `goggalaxy://openGameView/${gogGame.id}`,
            runTask: async () => {
                const args = `/command=runGame /gameId=${gogGame.id} /path="${gogGame.path}"`
                await execAsync(`"${gogClient.exePath}" ${args}`)
            }
        }
    }
}