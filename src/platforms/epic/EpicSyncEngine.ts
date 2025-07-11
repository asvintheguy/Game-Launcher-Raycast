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
        console.log('Starting Epic Games synchronization...')
        try {
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
                    launchCommand: this.PrepareRunTask(epicGame.CatalogNamespace, epicGame.CatalogItemId, epicGame.AppName)
                }
                syncedGames.push(game)
            }

            this.SynchronizedGames = syncedGames
            console.log(`Epic Games synchronization completed. Found ${syncedGames.length} games.`)
        } catch (error) {
            console.error('Epic Games sync failed:', error)
            this.SynchronizedGames = []
            throw new Error(`Epic Games synchronization failed: ${error}`)
        }
    }

    private async GetEpicGamesFromMetadata(): Promise<EpicGame[]> {
        const manifestsPath = await this.getManifestDirectory()
        
        if (!manifestsPath) {
            console.error('Epic Games manifests directory not found')
            return []
        }

        if (!existsSync(manifestsPath)) {
            console.error(`The manifest directory ${manifestsPath} does not exist!`)
            return []
        }

        console.log(`Found Epic Games manifests at: ${manifestsPath}`)

        const epicGames: EpicGame[] = []
        
        let metadataFiles: string[]
        try {
            metadataFiles = readdirSync(manifestsPath).filter(file => file.endsWith('.item'))
        } catch (error) {
            console.error(`Failed to read manifest directory ${manifestsPath}:`, error)
            return []
        }

        if (metadataFiles.length === 0) {
            console.warn(`The manifest directory ${manifestsPath} does not contain any .item files`)
            return []
        }

        console.log(`Found ${metadataFiles.length} Epic Games manifest files`)

        for (const metadataFile of metadataFiles) {
            try {
                const fullPath = join(manifestsPath, metadataFile)
                const game = await this.deserializeManifestFile(fullPath)
                
                if (game) {
                    epicGames.push(game)
                }
            } catch (error) {
                console.error(`Failed to process manifest file ${metadataFile}:`, error)
                continue
            }
        }

        console.log(`Processed ${epicGames.length} Epic Games`)
        return epicGames
    }

    private async getManifestDirectory(): Promise<string | null> {
        // Try registry first (following C# EGSHandler pattern)
        const registryPath = await this.tryGetManifestDirFromRegistry()
        if (registryPath && existsSync(registryPath)) {
            console.log(`Found Epic Games manifest directory from registry: ${registryPath}`)
            return registryPath
        }

        // Fallback to default paths
        console.log('Registry lookup failed, trying default paths...')
        
        const defaultPaths = [
            "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
            `${process.env.PROGRAMDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`,
            `${process.env.LOCALAPPDATA}\\EpicGamesLauncher\\Saved\\Manifests`,
            `${process.env.APPDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`
        ]
        
        for (const defaultPath of defaultPaths) {
            if (defaultPath && existsSync(defaultPath)) {
                console.log(`Found Epic Games manifest directory at default path: ${defaultPath}`)
                return defaultPath
            }
        }

        return null
    }

    private async tryGetManifestDirFromRegistry(): Promise<string | null> {
        try {
            const manifestDir = await this.getRegistryValue(EpicGamesConsts.RegKeyPath, EpicGamesConsts.RegKeyValueName)
            return manifestDir || null
        } catch (error) {
            console.warn('Failed to get manifest directory from registry:', error)
            return null
        }
    }

    private async deserializeManifestFile(itemFile: string): Promise<EpicGame | null> {
        try {
            const fileContent = readFileSync(itemFile, 'utf8')
            
            let jObject
            try {
                jObject = JSON.parse(fileContent)
            } catch (parseError) {
                // Try to fix common JSON issues and parse again
                try {
                    const fixedContent = this.fixMalformedJson(fileContent)
                    jObject = JSON.parse(fixedContent)
                } catch (secondParseError) {
                    console.warn(`Unable to deserialize file ${itemFile}: Invalid JSON`)
                    return null
                }
            }

            // Validate required fields (following C# validation pattern)
            if (!jObject.CatalogItemId) {
                console.warn(`Manifest ${itemFile} does not have a value "CatalogItemId"`)
                return null
            }

            if (!jObject.DisplayName) {
                console.warn(`Manifest ${itemFile} does not have a value "DisplayName"`)
                return null
            }

            if (!jObject.InstallLocation || jObject.InstallLocation.trim() === '') {
                console.warn(`Manifest ${itemFile} does not have a value "InstallLocation"`)
                return null
            }

            const game = EpicGame.CreateFromJObject(jObject)
            return game
        } catch (error) {
            console.error(`Unable to deserialize file ${itemFile}:`, error)
            return null
        }
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
            console.log(`Registry query result: ${result.stdout}`)
            const match = result.stdout.match(new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`))
            return match ? match[1].trim() : ''
        } catch (error) {
            return ''
        }
    }
}