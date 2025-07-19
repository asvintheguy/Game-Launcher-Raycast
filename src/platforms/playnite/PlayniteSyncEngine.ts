import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { Game, ISyncEngine, Preferences } from "../interfaces"
import { homedir } from "os"

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

export interface PlayniteRaycastGame {
    Id: string
    Name: string
    Source?: string
    Platform?: string
    ReleaseDate?: string
    Added?: string
    LastActivity?: string
    Playtime?: number
    InstallDirectory?: string
    IsInstalled: boolean
    Hidden?: boolean
    Favorite?: boolean
    CompletionStatus?: string
    UserScore?: number | null
    CriticScore?: number | null
    CommunityScore?: number | null
    Genres?: string[]
    Developers?: string[]
    Publishers?: string[]
    Categories?: string[]
    Tags?: string[]
    Features?: string[]
    Description?: string
    Notes?: string
    Manual?: string
    CoverImage?: string
    BackgroundImage?: string
    Icon?: string
}

export class PlayniteSyncEngine implements ISyncEngine {
    PlatformName = "Playnite"
    SynchronizedGames: Game[] = []

    constructor(private preferences?: Preferences) {}

    private getRaycastLibraryPath(): string {
        return join(homedir(), "Documents", "playnite-raycast-library.json")
    }

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

        const raycastLibraryPath = this.getRaycastLibraryPath()

        if (existsSync(raycastLibraryPath)) {
            try {
                const libraryData = JSON.parse(readFileSync(raycastLibraryPath, "utf8")) as PlayniteRaycastGame[]

                for (const gameData of libraryData) {
                    if (!gameData.IsInstalled || gameData.Hidden) continue

                    let iconPath: string | undefined
                    if (gameData.Icon) {
                        const fullIconPath = join(this.getPlayniteDataPath(), "library", "files", gameData.Icon)
                        iconPath = existsSync(fullIconPath) ? fullIconPath : undefined
                    }

                    let coverImagePath: string | undefined
                    if (gameData.CoverImage) {
                        const fullCoverPath = join(this.getPlayniteDataPath(), "library", "files", gameData.CoverImage)
                        coverImagePath = existsSync(fullCoverPath) ? fullCoverPath : undefined
                    }

                    const game: Game = {
                        id: gameData.Id,
                        title: gameData.Name,
                        platform: `${this.PlatformName}${gameData.Source ? ` (${gameData.Source})` : ""}`,
                        iconPath: iconPath,
                        launchCommand: `playnite://playnite/start/${gameData.Id}`,
                        description: gameData.Description,
                        source: gameData.Source,
                        developers: gameData.Developers,
                        publishers: gameData.Publishers,
                        genres: gameData.Genres,
                        releaseDate: gameData.ReleaseDate,
                        lastActivity: gameData.LastActivity,
                        favorite: gameData.Favorite,
                        added: gameData.Added,
                        coverImage: coverImagePath,
                    }

                    this.SynchronizedGames.push(game)
                }

                return
            } catch (error) {
                console.warn("Failed to read raycast library file, falling back to individual JSON files:", error)
            }
        }

        const gamesPath = this.getGamesLibraryPath()

        if (!existsSync(gamesPath)) {
            throw new Error("Playnite library not found. Make sure Playnite is installed.")
        }

        const gameFiles = readdirSync(gamesPath).filter(file => file.endsWith(".json"))

        for (const gameFile of gameFiles) {
            try {
                const filePath = join(gamesPath, gameFile)
                const gameData = JSON.parse(readFileSync(filePath, "utf8")) as PlayniteGame

                if (!gameData.IsInstalled) continue

                const iconPath = this.getIconPath(gameData.Icon)

                const game: Game = {
                    id: gameData.Id,
                    title: gameData.Name,
                    platform: `${this.PlatformName}${gameData.Source?.Name ? ` (${gameData.Source.Name})` : ""}`,
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
