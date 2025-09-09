const fs = require("fs");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");

async function imagesToPdf(images, outputPdf) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const writeStream = fs.createWriteStream(outputPdf);
  doc.pipe(writeStream);

  // Process images in pairs for double-sided pages
  const pagePairs = [[images[3], images[0]], [images[1], images[2]]];

  for (const pair of pagePairs) {
    try {
      // Determine the landscape page size
      const firstImageMetadata = await sharp(pair[0]).metadata();
      const secondImageMetadata = await sharp(pair[1]).metadata();

      const pageWidth = firstImageMetadata.width + secondImageMetadata.width;
      const pageHeight = Math.max(firstImageMetadata.height, secondImageMetadata.height);

      // Add a new landscape page
      doc.addPage({ size: [pageWidth, pageHeight] });

      // Position the images side by side
      let xOffset = 0;
      for (const image of pair) {
        if (!image) continue;

        const { width, height } = await sharp(image).metadata();
        const scaledHeight = (doc.page.height / height) * height;
        const scaledWidth = (doc.page.height / height) * width;

        doc.image(image, xOffset, 0, { width: scaledWidth, height: scaledHeight });
        xOffset += scaledWidth;
      }
    } catch (error) {
      console.error(`Error processing image:`, error);
    }
  }

  // Finalize the PDF
  doc.end();

  writeStream.on("finish", () => {
    console.log(`PDF created successfully: ${outputPdf}`);
  });

  writeStream.on("error", (error) => {
    console.error("Error writing PDF:", error);
  });
}

const images = ["img/1.png", "img/2.png", "img/3.png", "img/4.png"];
const outputPdf = "wedding_invitations.pdf";

imagesToPdf(images, outputPdf);

