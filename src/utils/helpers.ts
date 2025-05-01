export function getDominantColor(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      context.drawImage(img, 0, 0);

      const imageData = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data;
      const colorMap: { [key: string]: number } = {};

      for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];

        const simplifiedR = Math.round(r / 32) * 32;
        const simplifiedG = Math.round(g / 32) * 32;
        const simplifiedB = Math.round(b / 32) * 32;

        const key = `${simplifiedR},${simplifiedG},${simplifiedB}`;
        colorMap[key] = (colorMap[key] || 0) + 1;
      }

      let maxCount = 0;
      let dominantColor = { r: 0, g: 0, b: 0 };

      for (const key in colorMap) {
        if (colorMap[key] > maxCount) {
          maxCount = colorMap[key];
          const [r, g, b] = key.split(",").map(Number);
          dominantColor = { r, g, b };
        }
      }

      resolve(
        `rgb(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b})`
      );
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Determines whether black or white text provides better contrast against a given RGB background color.
 *
 * @param rgbColor - The background color string in the format "rgb(r, g, b)".
 * @returns 'black' or 'white' depending on which provides better contrast.
 * Returns 'black' by default if the input format is invalid.
 */
export function getContrastTextColor(rgbColor: string): "black" | "white" {
  // 1. Parse the RGB string
  const match = rgbColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

  if (!match) {
    console.error("Invalid RGB color format provided:", rgbColor);
    // Default to black for invalid inputs
    return "black";
  }

  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);

  // Check if parsing resulted in valid numbers (0-255)
  if (
    isNaN(r) ||
    isNaN(g) ||
    isNaN(b) ||
    r < 0 ||
    r > 255 ||
    g < 0 ||
    g > 255 ||
    b < 0 ||
    b > 255
  ) {
    console.error("Invalid RGB values parsed:", { r, g, b });
    return "black"; // Default for invalid values
  }

  // 2. Calculate the perceptive luminance (YIQ color space)
  // Formula: Y = (R * 299 + G * 587 + B * 114) / 1000
  // This gives a value between 0 (black) and 255 (white).
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;

  // 3. Determine contrast color based on luminance threshold
  // A common threshold is 128 (half of 255).
  // If luminance is >= 128, the color is perceived as "light", use black text.
  // If luminance is < 128, the color is perceived as "dark", use white text.
  return luminance >= 128 ? "black" : "white";
}
