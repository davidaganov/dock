using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace Dock.Services;

public static partial class PortHelper
{
    public static bool IsPortOpen(int port)
    {
        try
        {
            using var client = new TcpClient();
            var task = client.ConnectAsync("127.0.0.1", port);
            return task.Wait(300) && client.Connected;
        }
        catch
        {
            return false;
        }
    }

    public static bool StopByPort(int port)
    {
        var killed = false;
        foreach (var pid in GetListeningProcessIds(port))
        {
            try
            {
                var process = Process.GetProcessById(pid);
                process.Kill(entireProcessTree: true);
                killed = true;
            }
            catch
            {
                // process may already be gone
            }
        }

        return killed || !IsPortOpen(port);
    }

    public static HashSet<int> GetListeningProcessIds(int port)
    {
        var pids = new HashSet<int>();
        var portToken = ":" + port.ToString(CultureInfo.InvariantCulture);

        var startInfo = new ProcessStartInfo
        {
            FileName = "netstat",
            Arguments = "-ano -p tcp",
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(startInfo);
        if (process is null)
        {
            return pids;
        }

        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit(5000);

        foreach (var line in output.Split('\n', '\r'))
        {
            if (!line.Contains("LISTENING", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!line.Contains(portToken, StringComparison.Ordinal))
            {
                continue;
            }

            var match = ListeningLineRegex().Match(line);
            if (match.Success && int.TryParse(match.Groups[1].Value, out var pid) && pid > 0)
            {
                pids.Add(pid);
            }
        }

        return pids;
    }

    [GeneratedRegex(@"LISTENING\s+(\d+)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex ListeningLineRegex();
}
