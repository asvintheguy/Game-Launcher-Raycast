// Epic Games Sync Engine - equivalent to C# EpicSyncEngine

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { ISyncEngine, Game } from "../interfaces"
import { EpicGame } from "./models/EpicGame"
import { EpicGamesConsts } from "./EpicGamesConsts"
import { getGameIcon } from "../../utils/IconUtils"

const execAsync = promisify(exec)

export class EpicSyncEngine implements ISyncEngine {
    public PlatformName = "Epic Games"
    public SynchronizedGames: Game[] = []

    async SynchronizeGames(): Promise<void> {
        const epicGames = await this.GetEpicGamesFromMetadata()
        const syncedGames: Game[] = []

        for (const epicGame of epicGames) {
            const executablePath = this.getGameExecutablePath(epicGame)
            const iconPath = getGameIcon(executablePath)
            
            const game: Game = {
                id: `epic-${epicGame.AppName}`,
                title: epicGame.DisplayName,
                platform: this.PlatformName,
                iconPath: iconPath,
                launchCommand: this.PrepareRunTask(epicGame.CatalogNamespace, epicGame.CatalogItemId, epicGame.AppName),
                runTask: async () => {
                    // Launch game using system command
                    await execAsync(`start "" "${this.PrepareRunTask(epicGame.CatalogNamespace, epicGame.CatalogItemId, epicGame.AppName)}"`)
                }
            }
            syncedGames.push(game)
        }

        this.SynchronizedGames = syncedGames
    }

    private async GetEpicGamesFromMetadata(): Promise<EpicGame[]> {
        // Get metadata directory from registry (GameFinder approach)
        let manifestsPath = await this.getRegistryValue(EpicGamesConsts.RegKeyPath, EpicGamesConsts.RegKeyValueName)
        
        // Fallback to default paths if registry fails
        if (!manifestsPath || !existsSync(manifestsPath)) {
            const defaultPaths = [
                "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
                `${process.env.PROGRAMDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`,
                `${process.env.LOCALAPPDATA}\\EpicGamesLauncher\\Saved\\Manifests`,
                `${process.env.APPDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`
            ]
            
            for (const defaultPath of defaultPaths) {
                if (existsSync(defaultPath)) {
                    manifestsPath = defaultPath
                    break
                }
            }
            
            if (!manifestsPath || !existsSync(manifestsPath)) {
                console.log('Epic Games manifests directory not found')
                return []
            }
        }

        console.log(`Found Epic Games manifests at: ${manifestsPath}`)

        const epicGames: EpicGame[] = []
        const metadataFiles = readdirSync(manifestsPath).filter(file => file.endsWith('.item'))

        console.log(`Found ${metadataFiles.length} Epic Games manifest files`)

        for (const metadataFile of metadataFiles) {
            try {
                const fullPath = join(manifestsPath, metadataFile)
                const fileContent = readFileSync(fullPath, 'utf8')
                
                let jObject
                try {
                    jObject = JSON.parse(fileContent)
                } catch (parseError) {
                    // Try to fix common JSON issues and parse again
                    try {
                        const fixedContent = this.fixMalformedJson(fileContent)
                        jObject = JSON.parse(fixedContent)
                    } catch (secondParseError) {
                        // Silently skip malformed JSON files - they're not critical
                        continue
                    }
                }

                const game = EpicGame.CreateFromJObject(jObject)
                if (game != null) {
                    epicGames.push(game)
                }
            } catch (error) {
                // Silently skip files that can't be processed
                continue
            }
        }

        console.log(`Processed ${epicGames.length} Epic Games`)
        return epicGames
    }

    private PrepareRunTask(catalogNamespace: string, catalogItemId: string, appName: string): string {
        return `com.epicgames.launcher://apps/${catalogNamespace}%3A${catalogItemId}%3A${appName}?action=launch&silent=true`
    }

    private getGameExecutablePath(epicGame: EpicGame): string | undefined {
        // Return the executable path for icon extraction
        if (epicGame.InstallLocation != null && epicGame.LaunchExecutable != null) {
            return join(epicGame.InstallLocation, epicGame.LaunchExecutable)
        }
        
        return undefined
    }


    private fixMalformedJson(content: string): string {
        // Fix common JSON issues in Epic Games manifest files
        let fixed = content.trim()
        
        // Remove BOM (Byte Order Mark) characters
        fixed = fixed.replace(/^\uFEFF/, '')
        
        // Remove trailing commas before closing braces/brackets
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1')
        
        // Remove duplicate commas
        fixed = fixed.replace(/,(\s*,)+/g, ',')
        
        // Remove trailing commas at the end of the file
        fixed = fixed.replace(/,\s*$/, '')
        
        // Fix common quote issues - remove any stray quotes that might break JSON
        fixed = fixed.replace(/([^\\])"/g, '$1"')
        
        // Ensure the JSON starts and ends correctly
        fixed = fixed.replace(/^[^{]*/, '').replace(/[^}]*$/, '')
        
        return fixed
    }

    private async getRegistryValue(keyPath: string, valueName: string): Promise<string> {
        try {
            const result = await execAsync(`reg query "${keyPath}" /v ${valueName}`)
            const match = result.stdout.match(new RegExp(`${valueName}\\\\s+REG_SZ\\\\s+(.+)`))
            return match ? match[1].trim() : ''
        } catch (error) {
            return ''
        }
    }
}