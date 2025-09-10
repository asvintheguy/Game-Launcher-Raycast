import { Action, ActionPanel, Icon, List, showToast, Toast, getPreferenceValues, closeMainWindow } from "@raycast/api"
import { useCachedPromise } from "@raycast/utils"
import { useState } from "react"
import { exec } from "child_process"
import { promisify } from "util"
import { Game, Preferences, ISyncEngine } from "./platforms/interfaces"
import { SteamSyncEngine } from "./platforms/steam/SteamSyncEngine"
import { EpicSyncEngine } from "./platforms/epic/EpicSyncEngine"
import { GOGSyncEngine } from "./platforms/gog/GOGSyncEngine"
import { PlayniteSyncEngine } from "./platforms/playnite/PlayniteSyncEngine"
import { XboxSyncEngine } from "./platforms/xbox/XboxSyncEngine"
import { ShortcutsSyncEngine } from "./platforms/shortcuts/ShortcutsSyncEngine"

const execAsync = promisify(exec)
const preferences: Preferences = getPreferenceValues()

function createFancyGameTitle(title: string, isFavorite?: boolean, description?: string): string {
    const favoriteIcon = isFavorite ? " ⭐" : ""
    const gameDescription = description ? `\n\n${description}` : ""
    return `# 🎮 ${title}${favoriteIcon}\n\n---${gameDescription}`
}

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

    if (preferences.enablePlaynite) {
        syncEngines.push(new PlayniteSyncEngine(preferences))
    }

    if (preferences.enableXbox) {
        syncEngines.push(new XboxSyncEngine())
    }

    // Check if any shortcut directories are enabled
    const hasEnabledShortcuts =
        preferences.customDir1Enable ||
        preferences.customDir2Enable ||
        preferences.customDir3Enable ||
        preferences.customDir4Enable ||
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
                const platformOrder = { Steam: 1, "Epic Games": 2, GOG: 3, Xbox: 4, Playnite: 5 }
                return (
                    (platformOrder[a.platform as keyof typeof platformOrder] || 999) -
                    (platformOrder[b.platform as keyof typeof platformOrder] || 999)
                )
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
        if (game.launchCommand.startsWith("playnite://")) {
            await execAsync(`start "" "${game.launchCommand}"`)
        } else {
            await execAsync(`start "" "${game.launchCommand}"`)
        }

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
    const [showingDetail, setShowingDetail] = useState(true)
    const [groupByPlatform, setGroupByPlatform] = useState(false)
    const { data: games, isLoading, revalidate } = useCachedPromise(loadGames)

    const renderContent = () => {
        if (!games) return null
        
        if (groupByPlatform) {
            // Group games by platform
            const gamesByPlatform = games.reduce((acc, game) => {
                if (!acc[game.platform]) {
                    acc[game.platform] = []
                }
                acc[game.platform].push(game)
                return acc
            }, {} as Record<string, Game[]>)
            
            return Object.entries(gamesByPlatform).map(([platform, platformGames]) => (
                <List.Section key={platform} title={platform}>
                    {platformGames.map((game) => {
                        const fancyTitle = createFancyGameTitle(game.title, game.favorite, game.description)

                        const props: Partial<List.Item.Props> = showingDetail
                            ? {
                                  detail: (
                                      <List.Item.Detail
                                          markdown={fancyTitle}
                                          metadata={
                                              <List.Item.Detail.Metadata>
                                                  {game.source && (
                                                      <>
                                                          <List.Item.Detail.Metadata.Label title="Source" text={game.source} />
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.developers?.length && (
                                                      <>
                                                          <List.Item.Detail.Metadata.TagList
                                                              title={`Developer${game.developers.length > 1 ? "s" : ""}`}
                                                          >
                                                              {game.developers.map((dev, index) => (
                                                                  <List.Item.Detail.Metadata.TagList.Item
                                                                      key={index}
                                                                      text={dev}
                                                                  />
                                                              ))}
                                                          </List.Item.Detail.Metadata.TagList>
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.publishers?.length && (
                                                      <>
                                                          <List.Item.Detail.Metadata.TagList
                                                              title={`Publisher${game.publishers.length > 1 ? "s" : ""}`}
                                                          >
                                                              {game.publishers.map((pub, index) => (
                                                                  <List.Item.Detail.Metadata.TagList.Item
                                                                      key={index}
                                                                      text={pub}
                                                                  />
                                                              ))}
                                                          </List.Item.Detail.Metadata.TagList>
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.genres?.length && (
                                                      <>
                                                          <List.Item.Detail.Metadata.TagList title="Genres">
                                                              {game.genres.map((genre, index) => (
                                                                  <List.Item.Detail.Metadata.TagList.Item
                                                                      key={index}
                                                                      text={genre}
                                                                  />
                                                              ))}
                                                          </List.Item.Detail.Metadata.TagList>
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.releaseDate && (
                                                      <>
                                                          <List.Item.Detail.Metadata.Label
                                                              title="Release Date"
                                                              text={game.releaseDate}
                                                          />
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.added && (
                                                      <>
                                                          <List.Item.Detail.Metadata.Label title="Added" text={game.added} />
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  {game.lastActivity && (
                                                      <>
                                                          <List.Item.Detail.Metadata.Label
                                                              title="Last Activity"
                                                              text={game.lastActivity}
                                                          />
                                                          <List.Item.Detail.Metadata.Separator />
                                                      </>
                                                  )}
                                                  <List.Item.Detail.Metadata.Label title="Platform" text={game.platform} />
                                                  <List.Item.Detail.Metadata.Separator />
                                                  <List.Item.Detail.Metadata.Label title="Game ID" text={game.id} />
                                              </List.Item.Detail.Metadata>
                                          }
                                      />
                                  ),
                              }
                            : { accessories: [{ text: game.platform }] }

                        return (
                            <List.Item
                                key={game.id}
                                title={game.title}
                                subtitle={!showingDetail ? undefined : undefined}
                                icon={
                                    game.iconPath
                                        ? game.iconPath.endsWith(".exe")
                                            ? { fileIcon: game.iconPath }
                                            : { source: game.iconPath }
                                        : undefined
                                }
                                {...props}
                                actions={
                                    <ActionPanel>
                                        <Action
                                            title="Launch Game"
                                            icon={Icon.Play}
                                            onAction={() => launchGame(game)}
                                        />
                                        {game.platform.includes("Playnite") && (
                                            <Action
                                                title="Open in Playnite"
                                                icon={Icon.Window}
                                                onAction={async () => {
                                                    try {
                                                        await execAsync(
                                                            `start "" playnite://playnite/showgame/${game.id}`,
                                                        )
                                                        await showToast({
                                                            style: Toast.Style.Success,
                                                            title: "Opened in Playnite",
                                                            message: `Opened ${game.title} in Playnite`,
                                                        })
                                                    } catch (error) {
                                                        await showToast({
                                                            style: Toast.Style.Failure,
                                                            title: "Failed to open in Playnite",
                                                            message: `Could not open ${game.title} in Playnite`,
                                                        })
                                                    }
                                                }}
                                            />
                                        )}
                                        {game.uninstallCommand && (
                                            <Action
                                                title="Uninstall Game"
                                                icon={Icon.Trash}
                                                onAction={() => uninstallGame(game)}
                                                style={Action.Style.Destructive}
                                            />
                                        )}
                                        <Action
                                            title="Toggle Details"
                                            icon={Icon.AppWindowSidebarLeft}
                                            onAction={() => setShowingDetail(!showingDetail)}
                                            shortcut={{
                                                macOS: { modifiers: ["cmd"], key: "d" },
                                                windows: { modifiers: ["ctrl"], key: "d" },
                                            }}
                                        />
                                        <Action
                                            title={`${groupByPlatform ? "Disable" : "Enable"} Platform Grouping`}
                                            icon={Icon.AppWindowGrid3x3}
                                            onAction={() => setGroupByPlatform(!groupByPlatform)}
                                            shortcut={{
                                                macOS: { modifiers: ["cmd"], key: "g" },
                                                windows: { modifiers: ["ctrl"], key: "g" },
                                            }}
                                        />
                                        <Action
                                            title="Reload Games"
                                            icon={Icon.ArrowClockwise}
                                            onAction={revalidate}
                                            shortcut={{
                                                macOS: { modifiers: ["cmd"], key: "r" },
                                                windows: { modifiers: ["ctrl"], key: "r" },
                                            }}
                                        />
                                    </ActionPanel>
                                }
                            />
                        )
                    })}
                </List.Section>
            ))
        } else {
            // Render without grouping
            return games.map((game: Game) => {
                const fancyTitle = createFancyGameTitle(game.title, game.favorite, game.description)

                const props: Partial<List.Item.Props> = showingDetail
                    ? {
                          detail: (
                              <List.Item.Detail
                                  markdown={fancyTitle}
                                  metadata={
                                      <List.Item.Detail.Metadata>
                                          {game.source && (
                                              <>
                                                  <List.Item.Detail.Metadata.Label title="Source" text={game.source} />
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.developers?.length && (
                                              <>
                                                  <List.Item.Detail.Metadata.TagList
                                                      title={`Developer${game.developers.length > 1 ? "s" : ""}`}
                                                  >
                                                      {game.developers.map((dev, index) => (
                                                          <List.Item.Detail.Metadata.TagList.Item
                                                              key={index}
                                                              text={dev}
                                                          />
                                                      ))}
                                                  </List.Item.Detail.Metadata.TagList>
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.publishers?.length && (
                                              <>
                                                  <List.Item.Detail.Metadata.TagList
                                                      title={`Publisher${game.publishers.length > 1 ? "s" : ""}`}
                                                  >
                                                      {game.publishers.map((pub, index) => (
                                                          <List.Item.Detail.Metadata.TagList.Item
                                                              key={index}
                                                              text={pub}
                                                          />
                                                      ))}
                                                  </List.Item.Detail.Metadata.TagList>
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.genres?.length && (
                                              <>
                                                  <List.Item.Detail.Metadata.TagList title="Genres">
                                                      {game.genres.map((genre, index) => (
                                                          <List.Item.Detail.Metadata.TagList.Item
                                                              key={index}
                                                              text={genre}
                                                          />
                                                      ))}
                                                  </List.Item.Detail.Metadata.TagList>
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.releaseDate && (
                                              <>
                                                  <List.Item.Detail.Metadata.Label
                                                      title="Release Date"
                                                      text={game.releaseDate}
                                                  />
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.added && (
                                              <>
                                                  <List.Item.Detail.Metadata.Label title="Added" text={game.added} />
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          {game.lastActivity && (
                                              <>
                                                  <List.Item.Detail.Metadata.Label
                                                      title="Last Activity"
                                                      text={game.lastActivity}
                                                  />
                                                  <List.Item.Detail.Metadata.Separator />
                                              </>
                                          )}
                                          <List.Item.Detail.Metadata.Label title="Platform" text={game.platform} />
                                          <List.Item.Detail.Metadata.Separator />
                                          <List.Item.Detail.Metadata.Label title="Game ID" text={game.id} />
                                      </List.Item.Detail.Metadata>
                                  }
                              />
                          ),
                      }
                    : { accessories: [{ text: game.platform }] }

                return (
                    <List.Item
                        key={game.id}
                        title={game.title}
                        subtitle={!showingDetail ? game.platform : undefined}
                        icon={
                          game.iconPath 
                          ? game.iconPath.endsWith(".exe")
                            ? { fileIcon: game.iconPath }
                            : { source: game.iconPath }
                          : undefined
                        }
                        {...props}
                        actions={
                            <ActionPanel>
                                <Action title="Launch Game" icon={Icon.Play} onAction={() => launchGame(game)} />
                                {game.platform.includes("Playnite") && (
                                    <Action
                                        title="Open in Playnite"
                                        icon={Icon.Window}
                                        onAction={async () => {
                                            try {
                                                await execAsync(`start "" playnite://playnite/showgame/${game.id}`)
                                                await showToast({
                                                    style: Toast.Style.Success,
                                                    title: "Opened in Playnite",
                                                    message: `Opened ${game.title} in Playnite`,
                                                })
                                            } catch (error) {
                                                await showToast({
                                                    style: Toast.Style.Failure,
                                                    title: "Failed to open in Playnite",
                                                    message: `Could not open ${game.title} in Playnite`,
                                                })
                                            }
                                        }}
                                    />
                                )}
                                {game.uninstallCommand && (
                                    <Action
                                        title="Uninstall Game"
                                        icon={Icon.Trash}
                                        onAction={() => uninstallGame(game)}
                                        style={Action.Style.Destructive}
                                    />
                                )}
                                <Action
                                    title="Toggle Details"
                                    icon={Icon.AppWindowSidebarLeft}
                                    onAction={() => setShowingDetail(!showingDetail)}
                                    shortcut={{
                                        macOS: { modifiers: ["cmd"], key: "d" },
                                        windows: { modifiers: ["ctrl"], key: "d" },
                                    }}
                                />
                                <Action
                                    title={`${groupByPlatform ? "Disable" : "Enable"} Platform Grouping`}
                                    icon={Icon.AppWindowGrid3x3}
                                    onAction={() => setGroupByPlatform(!groupByPlatform)}
                                    shortcut={{
                                        macOS: { modifiers: ["cmd"], key: "g" },
                                        windows: { modifiers: ["ctrl"], key: "g" },
                                    }}
                                />
                                <Action
                                    title="Reload Games"
                                    icon={Icon.ArrowClockwise}
                                    onAction={revalidate}
                                    shortcut={{
                                        macOS: { modifiers: ["cmd"], key: "r" },
                                        windows: { modifiers: ["ctrl"], key: "r" },
                                    }}
                                />
                            </ActionPanel>
                        }
                    />
                )
            })
        }
    }
    
    return (
        <List isLoading={isLoading} isShowingDetail={showingDetail} searchBarPlaceholder="Search games...">
            {renderContent()}
            {!isLoading && (!games || games.length === 0) && (
                <List.EmptyView
                    title="No games found"
                    description="No games were detected on your system. Make sure you have Steam, Epic Games, GOG, Xbox, or Playnite installed."
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
