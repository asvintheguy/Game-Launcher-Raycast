// Shortcuts Sync Engine - equivalent to C# ShortcutsSyncEngine

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync, unlinkSync, readdirSync, statSync } from "fs"
import { join, basename, dirname, extname } from "path"
import { ISyncEngine, Game, Preferences } from "../interfaces"

const execAsync = promisify(exec)

interface ShortcutDirectory {
    path: string
    name: string
}

interface ShortcutInfo {
    path: string
    name: string
    iconPath?: string
    directory: ShortcutDirectory
}

export class ShortcutsSyncEngine implements ISyncEngine {
    public PlatformName = "Shortcut"
    public SynchronizedGames: Game[] = []
    
    private preferences: Preferences
    private shortcutDirectories: ShortcutDirectory[]

    constructor(preferences: Preferences) {
        this.preferences = preferences
        this.shortcutDirectories = this.getConfiguredDirectories()
    }

    async SynchronizeGames(): Promise<void> {
        const shortcuts = await this.findAllShortcuts()
        this.SynchronizedGames = shortcuts.map(shortcut => this.mapShortcutToGame(shortcut))
    }

    private getConfiguredDirectories(): ShortcutDirectory[] {
        const directories: ShortcutDirectory[] = []
        
        // Check each custom directory configuration
        const customDirs = [
            { path: this.preferences.customDir1, name: this.preferences.customDir1Name },
            { path: this.preferences.customDir2, name: this.preferences.customDir2Name },
            { path: this.preferences.customDir3, name: this.preferences.customDir3Name },
            { path: this.preferences.customDir4, name: this.preferences.customDir4Name },
            { path: this.preferences.customDir5, name: this.preferences.customDir5Name }
        ]

        for (const dir of customDirs) {
            if (dir.path && existsSync(dir.path)) {
                directories.push({
                    path: dir.path,
                    name: dir.name || basename(dir.path)
                })
            }
        }

        return directories
    }

    private async findAllShortcuts(): Promise<ShortcutInfo[]> {
        const shortcuts: ShortcutInfo[] = []
        const supportedExtensions = ['.url', '.lnk']

        for (const directory of this.shortcutDirectories) {
            try {
                const files = this.getAllFilesRecursively(directory.path)
                
                for (const filePath of files) {
                    const ext = extname(filePath).toLowerCase()
                    
                    if (supportedExtensions.includes(ext)) {
                        const shortcutInfo: ShortcutInfo = {
                            path: filePath,
                            name: basename(filePath, ext),
                            iconPath: await this.getIconPath(filePath),
                            directory
                        }
                        
                        shortcuts.push(shortcutInfo)
                    }
                }
            } catch (error) {
                // Skip directories that can't be read
                continue
            }
        }

        return shortcuts
    }

    private getAllFilesRecursively(dirPath: string): string[] {
        const files: string[] = []
        
        try {
            const entries = readdirSync(dirPath)
            
            for (const entry of entries) {
                const fullPath = join(dirPath, entry)
                const stat = statSync(fullPath)
                
                if (stat.isDirectory()) {
                    files.push(...this.getAllFilesRecursively(fullPath))
                } else if (stat.isFile()) {
                    files.push(fullPath)
                }
            }
        } catch (error) {
            // Skip directories that can't be read
        }
        
        return files
    }

    private async getIconPath(filePath: string): Promise<string | undefined> {
        const ext = extname(filePath).toLowerCase()
        
        if (ext === '.url') {
            try {
                const content = readFileSync(filePath, 'utf8')
                const lines = content.split('\n')
                
                for (const line of lines) {
                    const trimmedLine = line.trim()
                    if (trimmedLine.startsWith('IconFile=')) {
                        const iconPath = trimmedLine.replace('IconFile=', '').trim()
                        if (iconPath && existsSync(iconPath)) {
                            return iconPath
                        }
                    }
                }
            } catch (error) {
                // If we can't read the .url file, fall back to the file itself
            }
        }
        
        // For .lnk files or if no icon found in .url file, return the shortcut path
        return filePath
    }

    private mapShortcutToGame(shortcut: ShortcutInfo): Game {
        return {
            id: `shortcut-${Buffer.from(shortcut.path).toString('base64')}`,
            title: shortcut.name,
            platform: `${this.PlatformName} (${shortcut.directory.name})`,
            iconPath: shortcut.iconPath,
            launchCommand: shortcut.path,
            uninstallCommand: `Delete "${shortcut.name}"`,
            runTask: async () => {
                await this.runShortcut(shortcut.path)
            }
        }
    }

    private async runShortcut(shortcutPath: string): Promise<void> {
        try {
            const directory = dirname(shortcutPath)
            const fileName = basename(shortcutPath)
            
            // Change to the directory and run the shortcut
            await execAsync(`cd /d "${directory}" && start "" "${fileName}"`, { 
                cwd: directory 
            })
        } catch (error) {
            // Fallback: try to run the shortcut directly
            await execAsync(`start "" "${shortcutPath}"`)
        }
    }

    async deleteShortcut(gameId: string): Promise<void> {
        const game = this.SynchronizedGames.find(g => g.id === gameId)
        if (!game) {
            throw new Error(`Shortcut with ID ${gameId} not found`)
        }

        try {
            // Extract the original path from the base64 encoded ID
            const pathBuffer = Buffer.from(gameId.replace('shortcut-', ''), 'base64')
            const shortcutPath = pathBuffer.toString('utf8')
            
            if (existsSync(shortcutPath)) {
                unlinkSync(shortcutPath)
                
                // Re-synchronize to update the list
                await this.SynchronizeGames()
            }
        } catch (error) {
            throw new Error(`Failed to delete shortcut: ${error}`)
        }
    }

    updatePreferences(preferences: Preferences): void {
        this.preferences = preferences
        this.shortcutDirectories = this.getConfiguredDirectories()
    }
}