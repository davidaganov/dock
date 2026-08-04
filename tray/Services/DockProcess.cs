using System.Diagnostics;
using System.IO;

namespace Dock.Services;

public static class DockProcess
{
    public const int Port = 3848;

    private static Process? _process;

    public static string PanelRoot =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    public static void Start()
    {
        if (PortHelper.IsPortOpen(Port))
        {
            return;
        }

        if (_process is { HasExited: false })
        {
            return;
        }

        var script = Path.Combine(PanelRoot, "start-win.bat");
        if (!File.Exists(script))
        {
            throw new FileNotFoundException("start-win.bat not found", script);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"{script}\" server",
            WorkingDirectory = PanelRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        _process = Process.Start(startInfo);
        if (_process != null)
        {
            _process.EnableRaisingEvents = true;
            _process.Exited += (_, _) => { _process = null; };
        }
    }

    public static void Restart()
    {
        KillAll();
        System.Threading.Thread.Sleep(700);
        _process = null;
        Start();
    }

    public static void KillAll()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // ignore
        }

        PortHelper.StopByPort(Port);
    }
}
