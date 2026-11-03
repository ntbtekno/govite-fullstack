package infrastructure

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/rand"
)

// CaptchaPNG renders a code as a PNG data URL using only the stdlib. The font
// is a hand-built 5x7 bitmap for the captcha alphabet, so there is no external
// image/font dependency. The client only ever receives the picture, never the
// plaintext code.
type CaptchaPNG struct {
	Width  int
	Height int
}

// glyph is a 5x7 bitmap, one string per row, '#' = ink.
type glyph [7]string

// glyphs covers exactly the captcha alphabet
// (ABCDEFGHJKLMNPQRSTUVWXYZ23456789), avoiding 0/O/1/I/L.
var glyphs = map[rune]glyph{
	'A': {"01110", "10001", "10001", "11111", "10001", "10001", "10001"},
	'B': {"11110", "10001", "11110", "10001", "10001", "10001", "11110"},
	'C': {"01110", "10001", "10000", "10000", "10000", "10001", "01110"},
	'D': {"11110", "10001", "10001", "10001", "10001", "10001", "11110"},
	'E': {"11111", "10000", "10000", "11110", "10000", "10000", "11111"},
	'F': {"11111", "10000", "10000", "11110", "10000", "10000", "10000"},
	'G': {"01110", "10001", "10000", "10111", "10001", "10001", "01110"},
	'H': {"10001", "10001", "10001", "11111", "10001", "10001", "10001"},
	'J': {"00111", "00010", "00010", "00010", "10010", "10010", "01100"},
	'K': {"10001", "10010", "10100", "11000", "10100", "10010", "10001"},
	'L': {"10000", "10000", "10000", "10000", "10000", "10000", "11111"},
	'M': {"10001", "11011", "10101", "10101", "10001", "10001", "10001"},
	'N': {"10001", "11001", "10101", "10011", "10001", "10001", "10001"},
	'P': {"11110", "10001", "10001", "11110", "10000", "10000", "10000"},
	'Q': {"01110", "10001", "10001", "10001", "10101", "01110", "00001"},
	'R': {"11110", "10001", "10001", "11110", "10100", "10010", "10001"},
	'S': {"01111", "10000", "10000", "01110", "00001", "00001", "11110"},
	'T': {"11111", "00100", "00100", "00100", "00100", "00100", "00100"},
	'U': {"10001", "10001", "10001", "10001", "10001", "10001", "01110"},
	'V': {"10001", "10001", "10001", "10001", "10001", "01010", "00100"},
	'W': {"10001", "10001", "10001", "10101", "10101", "11011", "10001"},
	'X': {"10001", "10001", "01010", "00100", "01010", "10001", "10001"},
	'Y': {"10001", "10001", "01010", "00100", "00100", "00100", "00100"},
	'Z': {"11111", "00001", "00010", "00100", "01000", "10000", "11111"},
	'2': {"01110", "10001", "00001", "00110", "01000", "10000", "11111"},
	'3': {"11111", "00010", "00100", "00010", "00001", "10001", "01110"},
	'4': {"00010", "00110", "01010", "10010", "11111", "00010", "00010"},
	'5': {"11111", "10000", "11110", "00001", "00001", "10001", "01110"},
	'6': {"00110", "01000", "10000", "11110", "10001", "10001", "01110"},
	'7': {"11111", "00001", "00010", "00100", "01000", "01000", "01000"},
	'8': {"01110", "10001", "10001", "01110", "10001", "10001", "01110"},
	'9': {"01110", "10001", "10001", "01111", "00001", "00010", "01100"},
}

const (
	glyphW   = 5
	glyphH   = 7
	glyphGap = 6
	glyphPad = 10
)

func (c CaptchaPNG) Render(code string) (string, error) {
	w, h := c.Width, c.Height
	if w == 0 {
		w = 2*glyphPad + len(code)*(glyphW+glyphGap)
	}
	if h == 0 {
		h = 2 * glyphPad
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	bg := color.RGBA{R: 245, G: 245, B: 248, A: 255}
	draw.Draw(img, img.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)

	rng := rand.New(rand.NewSource(rand.Int63()))

	// Noise dots so a solver cannot threshold the image cleanly.
	for i := 0; i < w*h/20; i++ {
		x, y := rng.Intn(w), rng.Intn(h)
		g := uint8(165 + rng.Intn(70))
		img.SetRGBA(x, y, color.RGBA{R: g, G: g, B: g, A: 255})
	}
	// Distracting lines behind the glyphs.
	for i := 0; i < 3; i++ {
		x1, y1, x2, y2 := rng.Intn(w), rng.Intn(h), rng.Intn(w), rng.Intn(h)
		g := uint8(185 + rng.Intn(45))
		drawLine(img, x1, y1, x2, y2, color.RGBA{R: g, G: g, B: g, A: 255})
	}

	scale := 1
	if h >= 48 {
		scale = 3
	} else if h >= 32 {
		scale = 2
	}
	digitW := glyphW * scale
	step := digitW + glyphGap*scale
	startX := (w - (step*len(code) - glyphGap*scale)) / 2
	ink := color.RGBA{R: 20, G: 20, B: 30, A: 255}
	for i, ch := range code {
		g, ok := glyphs[ch]
		if !ok {
			continue
		}
		// Vertical jitter keeps glyphs from lining up perfectly.
		y0 := (h-glyphH*scale)/2 + rng.Intn(5)*scale - 2*scale
		for row := 0; row < glyphH; row++ {
			for col := 0; col < glyphW; col++ {
				if g[row][col] != '#' {
					continue
				}
				px := startX + i*step + col*scale
				py := y0 + row*scale
				for dy := 0; dy < scale; dy++ {
					for dx := 0; dx < scale; dx++ {
						img.SetRGBA(px+dx, py+dy, ink)
					}
				}
			}
		}
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
