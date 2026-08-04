using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using Dock.Services;

namespace Dock;

internal static class Program
{
    private const string MutexName = "Local\\DockTrayLauncher";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew)
        {
            if (PortHelper.IsPortOpen(DockProcess.Port))
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:3848") { UseShellExecute = true });
            }
            return;
        }

        try
        {
            DockProcess.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                TrayLocale.T("serverStartFailed", ("error", ex.Message)),
                "Dock",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayAppContext());
    }
}
