// Steam Sync Engine - Based on GameFinder C# implementation
// https://github.com/erri120/GameFinder/tree/master/src/GameFinder.StoreHandlers.Steam

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { ISyncEngine, Game } from "../interfaces"
import { getGameIcon } from "../../utils/IconUtils"

const execAsync = promisify(exec)

interface SteamLibraryFolder {
    path: string
    label: string
    tool: string
}

interface SteamAppManifest {
    appid: string
    name: string
    StateFlags: string
    installdir: string
    LastUpdated: string
    SizeOnDisk: string
}

export class SteamSyncEngine implements ISyncEngine {
    public PlatformName = "Steam"
    public SynchronizedGames: Game[] = []

    async SynchronizeGames(): Promise<void> {
        try {
            const steamGames = await this.findAllGames()
            this.SynchronizedGames = steamGames
        } catch (error) {
            console.error('Steam sync failed:', error)
            this.SynchronizedGames = []
        }
    }

    private async findAllGames(): Promise<Game[]> {
        const games: Game[] = []
        const seenAppIds = new Set<string>()
        
        // Step 1: Find Steam installation path
        const steamPath = await this.findSteamInstallPath()
        if (!steamPath) {
            console.log('Steam installation not found')
            return games
        }

        console.log(`Found Steam at: ${steamPath}`)

        // Step 2: Parse library folders manifest
        const libraryFolders = await this.parseLibraryFoldersManifest(steamPath)
        
        // Step 3: Add default steamapps folder
        libraryFolders.unshift({
            path: join(steamPath, 'steamapps'),
            label: '',
            tool: '0'
        })

        console.log(`Found ${libraryFolders.length} library folders`)

        // Step 4: Scan each library folder for games
        for (const library of libraryFolders) {
            try {
                const libraryGames = await this.scanLibraryFolder(library, steamPath, seenAppIds)
                games.push(...libraryGames)
                console.log(`Found ${libraryGames.length} games in ${library.path}`)
            } catch (error) {
                console.error(`Failed to scan library folder ${library.path}:`, error)
            }
        }

        console.log(`Total Steam games found: ${games.length}`)
        return games
    }

    private async findSteamInstallPath(): Promise<string | null> {
        // Try common Steam installation paths first
        const commonPaths = [
            'C:\\Program Files (x86)\\Steam',
            'C:\\Program Files\\Steam',
            process.env.PROGRAMFILES + '\\Steam',
            process.env['PROGRAMFILES(X86)'] + '\\Steam'
        ]

        for (const path of commonPaths) {
            if (path && existsSync(path) && existsSync(join(path, 'steam.exe'))) {
                return path
            }
        }

        // Try registry lookup
        try {
            const result = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath')
            const match = result.stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)
            if (match) {
                const path = match[1].trim()
                if (existsSync(path) && existsSync(join(path, 'steam.exe'))) {
                    return path
                }
            }
        } catch (error) {
            // Try 32-bit registry
            try {
                const result32 = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Valve\\Steam" /v InstallPath')
                const match32 = result32.stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)
                if (match32) {
                    const path = match32[1].trim()
                    if (existsSync(path) && existsSync(join(path, 'steam.exe'))) {
                        return path
                    }
                }
            } catch (error2) {
                // Registry lookup failed
            }
        }

        return null
    }

    private async parseLibraryFoldersManifest(steamPath: string): Promise<SteamLibraryFolder[]> {
        const manifestPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
        const libraries: SteamLibraryFolder[] = []

        if (!existsSync(manifestPath)) {
            console.log('libraryfolders.vdf not found')
            return libraries
        }

        try {
            const content = readFileSync(manifestPath, 'utf8')
            
            // Parse VDF format - look for library entries
            const libraryRegex = /"(\d+)"\s*\{([^}]+)\}/g
            let match

            while ((match = libraryRegex.exec(content)) !== null) {
                const libraryContent = match[2]
                
                // Extract path from library content
                const pathMatch = libraryContent.match(/"path"\s+"([^"]+)"/)
                if (pathMatch) {
                    const libraryPath = pathMatch[1].replace(/\\\\/g, '\\')
                    
                    // Extract label if present
                    const labelMatch = libraryContent.match(/"label"\s+"([^"]*)"/)
                    const label = labelMatch ? labelMatch[1] : ''
                    
                    // Extract tool if present
                    const toolMatch = libraryContent.match(/"tool"\s+"([^"]*)"/)
                    const tool = toolMatch ? toolMatch[1] : '0'
                    
                    libraries.push({
                        path: join(libraryPath, 'steamapps'),
                        label,
                        tool
                    })
                }
            }
        } catch (error) {
            console.error('Failed to parse libraryfolders.vdf:', error)
        }

        return libraries
    }

    private async scanLibraryFolder(library: SteamLibraryFolder, steamPath: string, seenAppIds: Set<string>): Promise<Game[]> {
        const games: Game[] = []
        
        if (!existsSync(library.path)) {
            return games
        }

        try {
            const files = readdirSync(library.path)
            const manifestFiles = files.filter(file => file.startsWith('appmanifest_') && file.endsWith('.acf'))
            
            for (const manifestFile of manifestFiles) {
                try {
                    const manifestPath = join(library.path, manifestFile)
                    const manifest = await this.parseAppManifest(manifestPath)
                    
                    if (manifest && this.isGameInstalled(manifest) && this.isActualGame(manifest)) {
                        // Check for duplicates using appid
                        if (!seenAppIds.has(manifest.appid)) {
                            seenAppIds.add(manifest.appid)
                            const game = this.createGameFromManifest(manifest, steamPath)
                            games.push(game)
                        }
                    }
                } catch (error) {
                    console.error(`Failed to parse manifest ${manifestFile}:`, error)
                }
            }
        } catch (error) {
            console.error(`Failed to read library folder ${library.path}:`, error)
        }

        return games
    }

    private async parseAppManifest(manifestPath: string): Promise<SteamAppManifest | null> {
        try {
            const content = readFileSync(manifestPath, 'utf8')
            
            const appid = this.extractVdfValue(content, 'appid')
            const name = this.extractVdfValue(content, 'name')
            const StateFlags = this.extractVdfValue(content, 'StateFlags')
            const installdir = this.extractVdfValue(content, 'installdir')
            const LastUpdated = this.extractVdfValue(content, 'LastUpdated')
            const SizeOnDisk = this.extractVdfValue(content, 'SizeOnDisk')

            if (!appid || !name) {
                return null
            }

            return {
                appid,
                name,
                StateFlags: StateFlags || '0',
                installdir: installdir || '',
                LastUpdated: LastUpdated || '0',
                SizeOnDisk: SizeOnDisk || '0'
            }
        } catch (error) {
            console.error(`Failed to parse manifest ${manifestPath}:`, error)
            return null
        }
    }

    private extractVdfValue(content: string, key: string): string | null {
        const regex = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')
        const match = content.match(regex)
        return match ? match[1] : null
    }

    private isGameInstalled(manifest: SteamAppManifest): boolean {
        const stateFlags = parseInt(manifest.StateFlags) || 0
        // StateFlags & 4 means fully installed
        return (stateFlags & 4) !== 0
    }

    private isActualGame(manifest: SteamAppManifest): boolean {
        // Filter out non-game entries
        const excludeNames = [
            'Steamworks Common Redistributables',
            'Steam Linux Runtime',
            'Proton',
            'DirectX',
            'Visual C++',
            'Microsoft Visual C++',
            '.NET Framework',
            'Common Redistributables'
        ]
        
        const gameName = manifest.name.toLowerCase()
        return !excludeNames.some(exclude => gameName.includes(exclude.toLowerCase()))
    }

    private createGameFromManifest(manifest: SteamAppManifest, steamPath: string): Game {
        const executablePath = this.getSteamGameExecutable(steamPath, manifest)
        const iconPath = getGameIcon(executablePath)
        
        return {
            id: `steam-${manifest.appid}`,
            title: manifest.name,
            platform: this.PlatformName,
            iconPath: iconPath,
            launchCommand: `steam://launch/${manifest.appid}`,
            uninstallCommand: `steam://uninstall/${manifest.appid}`,
            runTask: async () => {
                await execAsync(`start "" "steam://launch/${manifest.appid}"`)
            }
        }
    }

    private getSteamGameExecutable(steamPath: string, manifest: SteamAppManifest): string | undefined {
        try {
            // Try to find the game's executable for icon extraction
            if (manifest.installdir) {
                // Look for common executable patterns in the game's install directory
                const gameInstallPath = join(steamPath, 'steamapps', 'common', manifest.installdir)
                
                if (existsSync(gameInstallPath)) {
                    const files = readdirSync(gameInstallPath)
                    
                    // Look for executable files, prioritizing ones that match the game name
                    const gameNameWords = manifest.name.toLowerCase().split(/[\s\-_]+/)
                    const exeFiles = files.filter(file => file.toLowerCase().endsWith('.exe'))
                    
                    // First try to find exe that matches game name
                    for (const word of gameNameWords) {
                        const matchingExe = exeFiles.find(exe => 
                            exe.toLowerCase().includes(word) && word.length > 2
                        )
                        if (matchingExe) {
                            return join(gameInstallPath, matchingExe)
                        }
                    }
                    
                    // Fallback to any executable file
                    if (exeFiles.length > 0) {
                        return join(gameInstallPath, exeFiles[0])
                    }
                }
            }
        } catch (error) {
            // Executable lookup failed
        }
        
        return undefined
    }
}