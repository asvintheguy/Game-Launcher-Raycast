// Epic Game model - equivalent to C# EpicGame

export class EpicGame {
    public DisplayName: string
    public AppName: string
    public CatalogNamespace: string
    public CatalogItemId: string
    public InstallLocation: string | null
    public LaunchExecutable: string | null
    public bIsApplication: boolean

    constructor(
        displayName: string,
        appName: string,
        catalogNamespace: string,
        catalogItemId: string,
        installLocation: string | null,
        launchExecutable: string | null,
        bIsApplication: boolean
    ) {
        this.DisplayName = displayName
        this.AppName = appName
        this.CatalogNamespace = catalogNamespace
        this.CatalogItemId = catalogItemId
        this.InstallLocation = installLocation
        this.LaunchExecutable = launchExecutable
        this.bIsApplication = bIsApplication
    }

    // Equivalent to C# EpicGame.CreateFromJObject
    public static CreateFromJObject(jObject: any): EpicGame | null {
        try {
            // Only create if it's an application (like C# version)
            if (!jObject.bIsApplication) {
                return null
            }

            return new EpicGame(
                jObject.DisplayName,
                jObject.AppName,
                jObject.CatalogNamespace,
                jObject.CatalogItemId,
                jObject.InstallLocation,
                jObject.LaunchExecutable,
                jObject.bIsApplication
            )
        } catch (error) {
            return null
        }
    }
}