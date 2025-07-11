// Platform interfaces - equivalent to C# ISyncEngine and Game models

export interface Game {
    id: string
    title: string
    platform: string
    iconPath?: string
    launchCommand: string
    uninstallCommand?: string
}

export interface ISyncEngine {
    PlatformName: string
    SynchronizedGames: Game[]
    SynchronizeGames(): Promise<void>
}

export interface Preferences {
    enableSteam: boolean
    enableEpicGames: boolean
    enableGOG: boolean
    enableUbisoft: boolean
    enableEAApp: boolean
    enableShortcuts: boolean
    sortOrder: string
    // Custom shortcut directories
    customDir1?: string
    customDir1Name?: string
    customDir2?: string
    customDir2Name?: string
    customDir3?: string
    customDir3Name?: string
    customDir4?: string
    customDir4Name?: string
    customDir5?: string
    customDir5Name?: string
}