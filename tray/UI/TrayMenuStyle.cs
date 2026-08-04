using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Dock.UI;

public sealed class TrayMenuRenderer : ToolStripProfessionalRenderer
{
    public const int IconSize = 16;
    public const int LeftPad = 10;
    public const int IconTextGap = 8;
    public const int RightPad = 10;
    public const int RowRadius = 6;
    public const int HoverInset = 5;
    public const int RowVInset = 1;

    public static readonly Font ItemFont = new("Segoe UI", 9.25f, FontStyle.Regular);

    private static readonly Color Bg = Color.FromArgb(32, 36, 46);
    private static readonly Color Hover = Color.FromArgb(142, 116, 196);
    private static readonly Color SeparatorColor = Color.FromArgb(56, 62, 76);

    public TrayMenuRenderer() : base(new TrayColorTable())
    {
        RoundedEdges = false;
    }

    public static int MeasureMenuWidth(ContextMenuStrip menu)
    {
        var maxRow = 0;
        foreach (ToolStripItem item in menu.Items)
        {
            if (item is ToolStripSeparator)
            {
                continue;
            }

            var textW = TextRenderer.MeasureText(
                item.Text,
                ItemFont,
                new Size(int.MaxValue, int.MaxValue),
                TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Width;

            var rowW = LeftPad + IconSize + IconTextGap + textW + RightPad;
            if (rowW > maxRow)
            {
                maxRow = rowW;
            }
        }

        // Content is left-aligned; do not add HoverInset here — it only insets the hover pill.
        return maxRow + menu.Padding.Horizontal;
    }

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        var rect = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
        using var path = RoundedRect(rect, 8);
        using var pen = new Pen(Color.FromArgb(45, 50, 62));
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.DrawPath(pen, path);
    }

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
    {
        var rect = new Rectangle(0, 0, e.ToolStrip.Width, e.ToolStrip.Height);
        using var path = RoundedRect(rect, 8);
        using var brush = new SolidBrush(Bg);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (e.Item is ToolStripSeparator)
        {
            return;
        }

        if (!e.Item.Selected && !e.Item.Pressed)
        {
            return;
        }

        var row = ItemRow(e.Item);
        var hoverRect = new Rectangle(
            row.Left + HoverInset,
            row.Top + RowVInset,
            row.Width - HoverInset * 2,
            row.Height - RowVInset * 2);

        using var path = RoundedRect(hoverRect, RowRadius);
        using var brush = new SolidBrush(Hover);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnRenderItemImage(ToolStripItemImageRenderEventArgs e)
    {
        // Icon drawn together with text in OnRenderItemText
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        if (e.Item is ToolStripSeparator)
        {
            return;
        }

        var row = ItemRow(e.Item);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;

        var image = e.Item.Image;
        if (image is not null)
        {
            var ix = row.Left + LeftPad;
            var iy = row.Top + (row.Height - IconSize) / 2;
            g.DrawImage(image, ix, iy, IconSize, IconSize);
        }

        if (string.IsNullOrEmpty(e.Text))
        {
            return;
        }

        var textX = row.Left + LeftPad + IconSize + IconTextGap;
        var textRect = new Rectangle(
            textX,
            row.Top,
            row.Width - textX - RightPad,
            row.Height);

        TextRenderer.DrawText(
            g,
            e.Text,
            ItemFont,
            textRect,
            e.Item.Enabled ? e.TextColor : SystemColors.GrayText,
            TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        var y = e.Item.Height / 2;
        var left = HoverInset + LeftPad;
        var right = e.Item.Width - HoverInset - RightPad;
        using var pen = new Pen(SeparatorColor);
        e.Graphics.DrawLine(pen, left, y, right, y);
    }

    private static Rectangle ItemRow(ToolStripItem item)
    {
        return new Rectangle(0, 0, item.Width, item.Height);
    }

    private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        if (d > bounds.Height)
        {
            d = bounds.Height;
        }

        if (d > bounds.Width)
        {
            d = bounds.Width;
        }

        if (d < 2)
        {
            path.AddRectangle(bounds);
            path.CloseFigure();
            return path;
        }

        path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class TrayColorTable : ProfessionalColorTable
{
    public override Color MenuBorder => Color.FromArgb(45, 50, 62);
    public override Color MenuItemBorder => Color.Transparent;
    public override Color MenuItemSelected => Color.FromArgb(142, 116, 196);
    public override Color MenuItemSelectedGradientBegin => Color.FromArgb(142, 116, 196);
    public override Color MenuItemSelectedGradientEnd => Color.FromArgb(142, 116, 196);
    public override Color MenuStripGradientBegin => Color.FromArgb(32, 36, 46);
    public override Color MenuStripGradientEnd => Color.FromArgb(32, 36, 46);
    public override Color ToolStripDropDownBackground => Color.FromArgb(32, 36, 46);
    public override Color ImageMarginGradientBegin => Color.FromArgb(32, 36, 46);
    public override Color ImageMarginGradientMiddle => Color.FromArgb(32, 36, 46);
    public override Color ImageMarginGradientEnd => Color.FromArgb(32, 36, 46);
    public override Color SeparatorDark => Color.FromArgb(56, 62, 76);
    public override Color SeparatorLight => Color.FromArgb(56, 62, 76);
}
