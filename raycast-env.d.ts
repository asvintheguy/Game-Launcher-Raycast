/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
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
  /** Enable Shortcuts - Enable custom shortcut detection and launching */
  "enableShortcuts": boolean,
  /** Custom Directory 1 Name - Display name for first custom directory */
  "customDir1Name": string,
  /** Custom Directory 1 - First custom directory for shortcuts */
  "customDir1"?: string,
  /** Custom Directory 2 Name - Display name for second custom directory */
  "customDir2Name": string,
  /** Custom Directory 2 - Second custom directory for shortcuts */
  "customDir2"?: string,
  /** Custom Directory 3 Name - Display name for third custom directory */
  "customDir3Name": string,
  /** Custom Directory 3 - Third custom directory for shortcuts */
  "customDir3"?: string,
  /** Custom Directory 4 Name - Display name for fourth custom directory */
  "customDir4Name": string,
  /** Custom Directory 4 - Fourth custom directory for shortcuts */
  "customDir4"?: string,
  /** Custom Directory 5 Name - Display name for fifth custom directory */
  "customDir5Name": string,
  /** Custom Directory 5 - Fifth custom directory for shortcuts */
  "customDir5"?: string,
  /** Game Sort Order - Choose how games are sorted in the list */
  "sortOrder": "alphabetical" | "lastPlayed" | "platform"
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `launch-game` command */
  export type LaunchGame = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `launch-game` command */
  export type LaunchGame = {}
}

