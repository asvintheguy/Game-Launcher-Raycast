// Epic Games constants - Based on GameFinder EGS implementation

export class EpicGamesConsts {
    public static readonly RegKeyPath = "HKEY_CURRENT_USER\\Software\\Epic Games\\EOS"
    public static readonly RegKeyValueName = "ModSdkMetadataDir"
    
    // Default manifest paths to try as fallback
    public static readonly DefaultManifestPaths: string[] = [
        "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
        `${process.env.PROGRAMDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`,
        `${process.env.LOCALAPPDATA}\\EpicGamesLauncher\\Saved\\Manifests`,
        `${process.env.APPDATA}\\Epic\\EpicGamesLauncher\\Data\\Manifests`
    ]
}