import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { Game, ISyncEngine, Preferences } from "../interfaces"

export interface PlayniteGame {
    Id: string
    Name: string
    Icon?: string
    CoverImage?: string
    BackgroundImage?: string
    Source?: {
        Name: string
    }
    IsInstalled: boolean
    InstallDirectory?: string
    GameActions?: Array<{
        Name: string
        Type: number
        Path: string
        Arguments?: string
        IsPlayAction: boolean
    }>
}

export class PlayniteSyncEngine implements ISyncEngine {
    PlatformName = "Playnite"
    SynchronizedGames: Game[] = []
    
    constructor(private preferences?: Preferences) {}

    private getPlayniteDataPath(): string {
        if (this.preferences?.playniteDataPath && existsSync(this.preferences.playniteDataPath)) {
            return this.preferences.playniteDataPath
        }
        
        const appdata = process.env.APPDATA
        if (!appdata) {
            throw new Error("APPDATA environment variable not found")
        }
        return join(appdata, "Playnite")
    }

    private getGamesLibraryPath(): string {
        return join(this.getPlayniteDataPath(), "library", "games")
    }

    private getIconPath(iconId?: string): string | undefined {
        if (!iconId) return undefined
        
        const mediaPath = join(this.getPlayniteDataPath(), "library", "files", iconId)
        return existsSync(mediaPath) ? mediaPath : undefined
    }

    async SynchronizeGames(): Promise<void> {
        this.SynchronizedGames = []
        
        const gamesPath = this.getGamesLibraryPath()
        
        if (!existsSync(gamesPath)) {
            throw new Error("Playnite library not found. Make sure Playnite is installed.")
        }

        const gameFiles = readdirSync(gamesPath).filter(file => file.endsWith('.json'))
        
        for (const gameFile of gameFiles) {
            try {
                const filePath = join(gamesPath, gameFile)
                const gameData = JSON.parse(readFileSync(filePath, 'utf8')) as PlayniteGame
                
                if (!gameData.IsInstalled) continue
                
                const iconPath = this.getIconPath(gameData.Icon)
                
                const game: Game = {
                    id: gameData.Id,
                    title: gameData.Name,
                    platform: `${this.PlatformName}${gameData.Source?.Name ? ` (${gameData.Source.Name})` : ''}`,
                    iconPath: iconPath,
                    launchCommand: `playnite://playnite/start/${gameData.Id}`,
                }

                this.SynchronizedGames.push(game)
            } catch (error) {
                console.warn(`Failed to parse game file ${gameFile}:`, error)
            }
        }
    }
}