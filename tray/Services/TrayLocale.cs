using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Dock.Services;

public static class TrayLocale
{
    private static readonly Dictionary<string, string> English = new(StringComparer.OrdinalIgnoreCase)
    {
        ["open"] = "Open",
        ["files"] = "Files",
        ["restart"] = "Restart",
        ["exit"] = "Exit",
        ["serverStartFailed"] = "Could not start the server:\n{error}",
        ["serverNotStarted"] = "Server did not start. Check Node.js / fnm.",
        ["restarting"] = "Stopping processes and restarting…",
        ["restartFailed"] = "Could not restart: {error}"
    };

    private static Dictionary<string, string>? _cache;
    private static string _cachedLocale = "";

    public static string Locale
    {
        get
        {
            try
            {
                var configPath = Path.Combine(DockProcess.PanelRoot, "dock-config.json");
                if (!File.Exists(configPath))
                {
                    return "en";
                }

                using var doc = JsonDocument.Parse(File.ReadAllText(configPath));
                if (doc.RootElement.TryGetProperty("locale", out var locale) &&
                    locale.ValueKind == JsonValueKind.String)
                {
                    var value = locale.GetString()?.Trim().ToLowerInvariant();
                    if (value is "en" or "ru")
                    {
                        return value;
                    }
                }
            }
            catch
            {
                // Fall back to English when config is missing or invalid.
            }

            return "en";
        }
    }

    public static string T(string key, params (string name, string value)[] vars)
    {
        EnsureLoaded();
        if (_cache is null || !_cache.TryGetValue(key, out var text))
        {
            English.TryGetValue(key, out text);
        }

        text ??= key;
        foreach (var (name, value) in vars)
        {
            text = text.Replace("{" + name + "}", value, StringComparison.Ordinal);
        }

        return text;
    }

    private static void EnsureLoaded()
    {
        var locale = Locale;
        if (_cache is not null && string.Equals(_cachedLocale, locale, StringComparison.Ordinal))
        {
            return;
        }

        _cachedLocale = locale;
        _cache = new Dictionary<string, string>(English, StringComparer.OrdinalIgnoreCase);

        try
        {
            var localePath = Path.Combine(DockProcess.PanelRoot, "public", "locales", $"{locale}.json");
            if (!File.Exists(localePath))
            {
                return;
            }

            using var doc = JsonDocument.Parse(File.ReadAllText(localePath));
            if (!doc.RootElement.TryGetProperty("tray", out var tray) ||
                tray.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            foreach (var prop in tray.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.String)
                {
                    var value = prop.Value.GetString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        _cache[prop.Name] = value;
                    }
                }
            }
        }
        catch
        {
            // Keep English fallbacks when locale files cannot be read.
        }
    }
}
