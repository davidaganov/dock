using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace Dock.Services;

public static class ExplorerHelper
{
    public static string WorkspaceRoot
    {
        get
        {
            var configPath = Path.Combine(DockProcess.PanelRoot, "dock-config.json");
            try
            {
                if (File.Exists(configPath))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(configPath));
                    if (doc.RootElement.TryGetProperty("homePath", out var home) &&
                        home.ValueKind == JsonValueKind.String)
                    {
                        var value = home.GetString();
                        if (!string.IsNullOrWhiteSpace(value) && Directory.Exists(value))
                        {
                            return Path.GetFullPath(value);
                        }
                    }
                }
            }
            catch
            {
                // fall through
            }

            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
    }

    public static void OpenFolder(string folderPath)
    {
        var fullPath = Path.GetFullPath(folderPath);
        if (!Directory.Exists(fullPath))
        {
            throw new DirectoryNotFoundException(fullPath);
        }

        Process.Start(new ProcessStartInfo("explorer.exe", fullPath) { UseShellExecute = true });
    }

    public static void OpenWorkspace() => OpenFolder(WorkspaceRoot);
}
