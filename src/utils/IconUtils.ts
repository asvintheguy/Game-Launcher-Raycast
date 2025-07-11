// Icon utility functions for game launcher

import { existsSync } from "fs"

/**
 * Get the icon path for a game executable
 * Returns the executable path if it exists, undefined otherwise
 * Raycast will handle the icon extraction natively using fileIcon
 */
export function getGameIcon(executablePath: string | undefined): string | undefined {
    if (!executablePath) {
        return undefined
    }
    
    if (existsSync(executablePath)) {
        return executablePath
    }
    
    return undefined
}
