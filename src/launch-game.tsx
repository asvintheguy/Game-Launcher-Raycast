import { Action, ActionPanel, Icon, List, showToast, Toast, getPreferenceValues, closeMainWindow } from "@raycast/api"
import { useCachedPromise } from "@raycast/utils"
import { exec } from "child_process"
import { promisify } from "util"
import { Game, Preferences, ISyncEngine } from "./platforms/interfaces"
import { SteamSyncEngine } from "./platforms/steam/SteamSyncEngine"
import { EpicSyncEngine } from "./platforms/epic/EpicSyncEngine"
import { GOGSyncEngine } from "./platforms/gog/GOGSyncEngine"
import { ShortcutsSyncEngine } from "./platforms/shortcuts/ShortcutsSyncEngine"

const execAsync = promisify(exec)
const preferences: Preferences = getPreferenceValues()

// Game loading using modular sync engines (like C# Flow Launcher architecture)
async function loadGames(): Promise<Game[]> {
    const allGames: Game[] = []
    
    // Initialize sync engines for enabled platforms
    const syncEngines: ISyncEngine[] = []
    
    if (preferences.enableSteam) {
        syncEngines.push(new SteamSyncEngine())
    }
    
    if (preferences.enableEpicGames) {
        syncEngines.push(new EpicSyncEngine())
    }
    
    if (preferences.enableGOG) {
        syncEngines.push(new GOGSyncEngine())
    }
    
    // Check if any shortcut directories are enabled
    const hasEnabledShortcuts = preferences.customDir1Enable || preferences.customDir2Enable || 
                               preferences.customDir3Enable || preferences.customDir4Enable || 
                               preferences.customDir5Enable
    
    if (hasEnabledShortcuts) {
        syncEngines.push(new ShortcutsSyncEngine(preferences))
    }
    
    // Synchronize games from all enabled platforms
    for (const syncEngine of syncEngines) {
        try {
            await syncEngine.SynchronizeGames()
            allGames.push(...syncEngine.SynchronizedGames)
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: `${syncEngine.PlatformName} detection failed`,
                message: `Could not detect ${syncEngine.PlatformName} games`,
            })
        }
    }
    
    // Sort games based on preference
    switch (preferences.sortOrder) {
        case "alphabetical":
            allGames.sort((a, b) => a.title.localeCompare(b.title))
            break
        case "platform":
            allGames.sort((a, b) => {
                const platformOrder = { "Steam": 1, "Epic Games": 2, "GOG": 3 }
                return (platformOrder[a.platform as keyof typeof platformOrder] || 999) - 
                       (platformOrder[b.platform as keyof typeof platformOrder] || 999)
            })
            break
        case "lastPlayed":
            // For now, keep original order (would need to track play times)
            break
    }
    
    await showToast({
        style: Toast.Style.Success,
        title: "Games loaded",
        message: `Found ${allGames.length} games`,
    })
    
    return allGames
}

async function launchGame(game: Game) {
    try {
        await execAsync(`start "" "${game.launchCommand}"`)
        
        await showToast({
            style: Toast.Style.Success,
            title: "Game launched",
            message: `Launched ${game.title}`,
        })
        
        await closeMainWindow()
    } catch (error) {
        await showToast({
            style: Toast.Style.Failure,
            title: "Launch failed",
            message: `Failed to launch ${game.title}`,
        })
    }
}

async function uninstallGame(game: Game) {
    if (!game.uninstallCommand) {
        await showToast({
            style: Toast.Style.Failure,
            title: "Uninstall not available",
            message: `${game.title} cannot be uninstalled from here`,
        })
        return
    }
    
    try {
        await execAsync(`start "" "${game.uninstallCommand}"`)
        
        await showToast({
            style: Toast.Style.Success,
            title: "Uninstall started",
            message: `Started uninstall for ${game.title}`,
        })
    } catch (error) {
        await showToast({
            style: Toast.Style.Failure,
            title: "Uninstall failed",
            message: `Failed to uninstall ${game.title}`,
        })
    }
}


export default function Command() {
    const { data: games, isLoading, revalidate } = useCachedPromise(loadGames)

    return (
        <List isLoading={isLoading} searchBarPlaceholder="Search games...">
            {games?.map((game: Game) => (
                <List.Item
                    key={game.id}
                    title={game.title}
                    subtitle={game.platform}
                    icon={game.iconPath ? { fileIcon: game.iconPath } : undefined}
                    actions={
                        <ActionPanel>
                            <Action 
                                title="Launch A Game" 
                                icon={Icon.Play} 
                                onAction={() => launchGame(game)} 
                            />
                            {game.uninstallCommand && (
                                <Action 
                                    title="Uninstall Game" 
                                    icon={Icon.Trash} 
                                    onAction={() => uninstallGame(game)}
                                    style={Action.Style.Destructive}
                                />
                            )}
                            <Action
                                title="Reload Games"
                                icon={Icon.ArrowClockwise}
                                onAction={revalidate}
                                shortcut={{ modifiers: ["cmd"], key: "r" }}
                            />
                        </ActionPanel>
                    }
                />
            ))}
            {!isLoading && (!games || games.length === 0) && (
                <List.EmptyView
                    title="No games found"
                    description="No games were detected on your system. Make sure you have Steam, Epic Games, or GOG installed."
                    actions={
                        <ActionPanel>
                            <Action title="Reload Games" icon={Icon.ArrowClockwise} onAction={revalidate} />
                        </ActionPanel>
                    }
                />
            )}
        </List>
    )
}