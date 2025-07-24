/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Game Sort Order - Choose how games are sorted in the list */
  "sortOrder": "alphabetical" | "lastPlayed" | "platform",
  /** Enable Steam - Enable Steam game detection and launching */
  "enableSteam": boolean,
  /** Enable Epic Games - Enable Epic Games game detection and launching */
  "enableEpicGames": boolean,
  /** Enable GOG - Enable GOG game detection and launching */
  "enableGOG": boolean,
  /** Enable Ubisoft Connect - Enable Ubisoft Connect game detection and launching */
  "enableUbisoft": boolean,
  /** Enable EA App - Enable EA App game detection and launching */
  "enableEAApp": boolean,
  /** Enable Playnite - Enable Playnite game library detection and launching */
  "enablePlaynite": boolean,
  /** Playnite Data Path - Custom path to Playnite data directory (leave empty for default %APPDATA%\Playnite) */
  "playniteDataPath"?: string,
  /** Enable Custom Directory 1 - Enable first custom directory for shortcuts */
  "customDir1Enable": boolean,
  /** Custom Directory 1 Name - Display name for first custom directory */
  "customDir1Name": string,
  /** Custom Directory 1 - First custom directory for shortcuts */
  "customDir1"?: string,
  /** Enable Custom Directory 2 - Enable second custom directory for shortcuts */
  "customDir2Enable": boolean,
  /** Custom Directory 2 Name - Display name for second custom directory */
  "customDir2Name": string,
  /** Custom Directory 2 - Second custom directory for shortcuts */
  "customDir2"?: string,
  /** Enable Custom Directory 3 - Enable third custom directory for shortcuts */
  "customDir3Enable": boolean,
  /** Custom Directory 3 Name - Display name for third custom directory */
  "customDir3Name": string,
  /** Custom Directory 3 - Third custom directory for shortcuts */
  "customDir3"?: string,
  /** Enable Custom Directory 4 - Enable fourth custom directory for shortcuts */
  "customDir4Enable": boolean,
  /** Custom Directory 4 Name - Display name for fourth custom directory */
  "customDir4Name": string,
  /** Custom Directory 4 - Fourth custom directory for shortcuts */
  "customDir4"?: string,
  /** Enable Custom Directory 5 - Enable fifth custom directory for shortcuts */
  "customDir5Enable": boolean,
  /** Custom Directory 5 Name - Display name for fifth custom directory */
  "customDir5Name": string,
  /** Custom Directory 5 - Fifth custom directory for shortcuts */
  "customDir5"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `launch-game` command */
  export type LaunchGame = ExtensionPreferences & {}
  /** Preferences accessible in the `setup-playnite` command */
  export type SetupPlaynite = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `launch-game` command */
  export type LaunchGame = {}
  /** Arguments passed to the `setup-playnite` command */
  export type SetupPlaynite = {}
}

