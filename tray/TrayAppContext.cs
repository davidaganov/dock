using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Dock.Services;
using Dock.UI;

namespace Dock;

public sealed class TrayAppContext : ApplicationContext
{
    private const string PanelUrl = "http://127.0.0.1:3848";

    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _menu;

    public TrayAppContext()
    {
        _menu = BuildMenu();
        _trayIcon = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "Dock",
            Visible = true,
            ContextMenuStrip = _menu
        };

        _trayIcon.DoubleClick += (_, _) => OpenPanel();

        BeginOpenPanelWhenReady();
    }

    private void BeginOpenPanelWhenReady()
    {
        var timer = new System.Windows.Forms.Timer { Interval = 400 };
        var attempts = 0;

        timer.Tick += (_, _) =>
        {
            attempts++;

            if (PortHelper.IsPortOpen(DockProcess.Port))
            {
                timer.Stop();
                timer.Dispose();
                OpenPanel();
                return;
            }

            if (attempts >= 40)
            {
                timer.Stop();
                timer.Dispose();
                _trayIcon.ShowBalloonTip(
                    5000,
                    "Dock",
                    TrayLocale.T("serverNotStarted"),
                    ToolTipIcon.Error);
            }
        };

        timer.Start();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip
        {
            Renderer = new TrayMenuRenderer(),
            ForeColor = Color.FromArgb(230, 234, 242),
            BackColor = Color.FromArgb(32, 36, 46),
            ShowImageMargin = false,
            ImageScalingSize = new Size(TrayMenuRenderer.IconSize, TrayMenuRenderer.IconSize),
            AutoSize = true,
            Padding = new Padding(4, 4, 4, 4)
        };

        var open = CreateItem(TrayLocale.T("open"), TrayMenuIcons.Open(), (_, _) => OpenPanel());
        var files = CreateItem(TrayLocale.T("files"), TrayMenuIcons.Folder(), (_, _) => ExplorerHelper.OpenWorkspace());
        var restart = CreateItem(TrayLocale.T("restart"), TrayMenuIcons.Restart(), (_, _) => RestartPanel());
        var exit = CreateItem(TrayLocale.T("exit"), TrayMenuIcons.Exit(), (_, _) =>
        {
            DockProcess.KillAll();
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            ExitThread();
        });

        menu.Items.Add(open);
        menu.Items.Add(files);
        menu.Items.Add(restart);
        menu.Items.Add(new ToolStripSeparator { Margin = new Padding(0, 2, 0, 2) });
        menu.Items.Add(exit);

        menu.Opening += (_, _) =>
        {
            var width = TrayMenuRenderer.MeasureMenuWidth(menu);
            menu.MinimumSize = new Size(width, 0);
            menu.MaximumSize = new Size(width, 0);
        };

        return menu;
    }

    private static ToolStripMenuItem CreateItem(string text, Image icon, EventHandler onClick)
    {
        var item = new ToolStripMenuItem(text, icon)
        {
            ForeColor = Color.FromArgb(230, 234, 242),
            ImageScaling = ToolStripItemImageScaling.None,
            DisplayStyle = ToolStripItemDisplayStyle.ImageAndText,
            Padding = new Padding(0, 4, 0, 4),
            Margin = Padding.Empty
        };
        item.Click += onClick;
        return item;
    }

    private void RestartPanel()
    {
        _trayIcon.ShowBalloonTip(
            2500,
            "Dock",
            TrayLocale.T("restarting"),
            ToolTipIcon.Info);

        try
        {
            DockProcess.Restart();
        }
        catch (Exception ex)
        {
            _trayIcon.ShowBalloonTip(
                5000,
                "Dock",
                TrayLocale.T("restartFailed", ("error", ex.Message)),
                ToolTipIcon.Error);
            return;
        }

        BeginOpenPanelWhenReady();
    }

    private static void OpenPanel()
    {
        if (!PortHelper.IsPortOpen(DockProcess.Port))
        {
            DockProcess.Start();
        }

        Process.Start(new ProcessStartInfo(PanelUrl) { UseShellExecute = true });
    }

    private static Icon LoadTrayIcon()
    {
        var icoPath = System.IO.Path.Combine(AppContext.BaseDirectory, "favicon.ico");
        if (System.IO.File.Exists(icoPath))
        {
            return new Icon(icoPath);
        }

        return CreateFallbackIcon();
    }

    private static Icon CreateFallbackIcon()
    {
        const int size = 32;
        using var bitmap = new Bitmap(size, size);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);

        using var brush = new SolidBrush(Color.FromArgb(142, 116, 196));
        graphics.FillEllipse(brush, new RectangleF(3, 3, size - 6, size - 6));

        using var whiteBrush = new SolidBrush(Color.White);
        graphics.FillRectangle(whiteBrush, 10, 9, 4, 14);
        graphics.FillRectangle(whiteBrush, 18, 9, 4, 14);
        graphics.FillRectangle(whiteBrush, 10, 20, 12, 3);

        return Icon.FromHandle(bitmap.GetHicon());
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _trayIcon.Dispose();
            _menu.Dispose();
        }
        base.Dispose(disposing);
    }
}
