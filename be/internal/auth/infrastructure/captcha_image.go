package infrastructure

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/rand"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// CaptchaPNG renders a code as a PNG data URL using only Go's standard and
// golang.org/x/image libraries. Glyphs come from the embedded "Go Bold" font,
// so legibility no longer depends on a hand-built bitmap. The client only ever
// receives the picture, never the plaintext code.
type CaptchaPNG struct {
	Width  int
	Height int
}

const (
	// Default canvas: large enough for five large, high-contrast characters.
	defaultWidth  = 240
	defaultHeight = 80
	// Font size in pixels; big enough to read all five characters at a glance.
	fontSize = 46
	// Horizontal padding kept clear of glyphs on each side.
	edgePad = 14
)

// parsedFont holds the TTF parsed once for the whole process.
var (
	parsedFont *opentype.Font
	fontErr    error
	fontOnce   sync.Once
)

func loadFont() (*opentype.Font, error) {
	fontOnce.Do(func() {
		parsedFont, fontErr = opentype.Parse(gobold.TTF)
	})
	return parsedFont, fontErr
}

// inkPalette is the set of dark colours a glyph may use. Every entry is a deep
// shade so the text stays high-contrast against the light background.
var inkPalette = []color.RGBA{
	{R: 10, G: 10, B: 15, A: 255},  // near black
	{R: 15, G: 30, B: 95, A: 255},  // dark blue
	{R: 10, G: 70, B: 35, A: 255},  // dark green
	{R: 120, G: 20, B: 25, A: 255}, // dark red
	{R: 75, G: 20, B: 95, A: 255},  // dark purple
	{R: 20, G: 65, B: 80, A: 255},  // dark teal
}

func (c CaptchaPNG) Render(code string) (string, error) {
	f, err := loadFont()
	if err != nil {
		return "", err
	}

	w, h := c.Width, c.Height
	if w < defaultWidth {
		w = defaultWidth
	}
	if h < defaultHeight {
		h = defaultHeight
	}

	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// White background for maximum contrast against the dark ink.
	bg := color.RGBA{R: 255, G: 255, B: 255, A: 255}
	draw.Draw(img, img.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)

	rng := rand.New(rand.NewSource(rand.Int63()))

	// Interference is painted first so the glyphs always sit on top. It stays
	// faint and thin: a few light grey dots and at most two light grey lines,
	// never darker or thicker than the text.
	for i := 0; i < w*h/160; i++ {
		x, y := rng.Intn(w), rng.Intn(h)
		g := uint8(215 + rng.Intn(30))
		img.SetRGBA(x, y, color.RGBA{R: g, G: g, B: g, A: 255})
	}
	line := color.RGBA{R: 205, G: 205, B: 210, A: 255}
	for i := 0; i < 2; i++ {
		x1, y1, x2, y2 := rng.Intn(w), rng.Intn(h), rng.Intn(w), rng.Intn(h)
		drawLine(img, x1, y1, x2, y2, line)
	}

	face, err := opentype.NewFace(f, &opentype.FaceOptions{
		Size:    fontSize,
		DPI:     72,
		Hinting: font.HintingFull,
	})
	if err != nil {
		return "", err
	}
	defer face.Close()

	advance := font.MeasureString(face, "M").Ceil()
	runes := []rune(code)
	total := advance * len(runes)
	startX := (w - total) / 2
	if startX < edgePad {
		startX = edgePad
	}

	// Metrics to seat the glyphs vertically inside the canvas.
	metrics := face.Metrics()
	capHeight := metrics.Ascent.Ceil()
	baselineBase := (h + capHeight) / 2

	drawer := &font.Drawer{Dst: img, Src: image.NewUniform(color.Black), Face: face}
	for i, ch := range runes {
		// Small vertical jitter keeps glyphs from aligning perfectly. No rotation.
		jitter := rng.Intn(7) - 3
		drawer.Src = image.NewUniform(inkPalette[rng.Intn(len(inkPalette))])
		drawer.Dot = fixed.P(startX+i*advance, baselineBase+jitter)
		drawer.DrawString(string(ch))
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// drawLine is a tiny Bresenham line so the captcha renderer stays stdlib-only.
func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.Color) {
	dx, dy := abs(x1-x0), -abs(y1-y0)
	sx, sy := -1, -1
	if x0 < x1 {
		sx = 1
	}
	if y0 < y1 {
		sy = 1
	}
	err := dx + dy
	for {
		img.Set(x0, y0, c)
		if x0 == x1 && y0 == y1 {
			return
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
