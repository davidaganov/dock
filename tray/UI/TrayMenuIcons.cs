using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Dock.UI;

public static class TrayMenuIcons
{
    private const int Size = 16;

    public static Image Open() => Draw(g =>
    {
        using var pen = new Pen(Color.FromArgb(200, 205, 215), 1.6f)
        {
            EndCap = LineCap.Round,
            StartCap = LineCap.Round
        };
        // external-link arrow
        g.DrawLine(pen, 4, 12, 12, 4);
        g.DrawLine(pen, 7, 4, 12, 4);
        g.DrawLine(pen, 12, 4, 12, 9);
    });

    public static Image Folder() => Draw(g =>
    {
        using var pen = new Pen(Color.FromArgb(200, 205, 215), 1.4f);
        g.DrawRectangle(pen, 2, 6, 12, 8);
        g.DrawLine(pen, 2, 6, 5, 3);
        g.DrawLine(pen, 5, 3, 8, 3);
        g.DrawLine(pen, 8, 3, 10, 6);
    });

    public static Image Restart() => Draw(g =>
    {
        using var pen = new Pen(Color.FromArgb(200, 205, 215), 1.6f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };
        g.DrawArc(pen, 3, 3, 10, 10, 40, 280);
        // arrow tip
        g.DrawLine(pen, 11, 3, 13, 6);
        g.DrawLine(pen, 11, 3, 8, 5);
    });

    public static Image Exit() => Draw(g =>
    {
        using var pen = new Pen(Color.FromArgb(200, 205, 215), 1.6f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };
        g.DrawLine(pen, 4, 4, 12, 12);
        g.DrawLine(pen, 12, 4, 4, 12);
    });

    private static Image Draw(System.Action<Graphics> paint)
    {
        var bmp = new Bitmap(Size, Size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.Clear(Color.Transparent);
        paint(g);
        return bmp;
    }
}
