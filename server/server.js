const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const docx = require("docx");
const { Document, Paragraph, TextRun, HeightRule } = docx;

const app = express();

// CORS setup
const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:3002"],
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Add OPTIONS handling for preflight requests
app.options('*', cors(corsOptions));

// JSON parser middleware
app.use(express.json());

// Serve static files from the processed directory
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOCX, and XLSX files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Load sensitive patterns
const sensitivePatterns = JSON.parse(
  fs.readFileSync("sensitive-words.json", "utf8")
).sensitivePatterns;

// Helper to create highlighted PDF
async function createHighlightedPDF(content, matches) {
  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    const fontSize = 12;
    let currentY = page.getHeight() - 50;
    const lineHeight = fontSize * 1.2;
    const maxWidth = page.getWidth() - 100; // 50px margin on each side
    
    // Sort matches by position
    matches.sort((a, b) => a.index - b.index);
    
    // Split content into lines
    const lines = content.split('\n');
    
    for (let line of lines) {
      if (line.trim() === '') {
        currentY -= lineHeight;
        continue;
      }
      
      // Check if line contains any matches
      const lineMatches = matches.filter(match => line.includes(match.match));
      
      if (lineMatches.length > 0) {
        let currentX = 50;
        let remainingLine = line;
        
        while (remainingLine.length > 0) {
          // Find the next match in this line
          let nextMatch = null;
          let matchStart = Infinity;
          
          for (const match of lineMatches) {
            const index = remainingLine.indexOf(match.match);
            if (index !== -1 && index < matchStart) {
              matchStart = index;
              nextMatch = match;
            }
          }
          
          if (nextMatch && matchStart !== Infinity) {
            // Draw text before match
            if (matchStart > 0) {
              const beforeText = remainingLine.substring(0, matchStart);
              page.drawText(beforeText, {
                x: currentX,
                y: currentY,
                font,
                size: fontSize,
                color: rgb(0, 0, 0)
              });
              currentX += font.widthOfTextAtSize(beforeText, fontSize);
            }
            
            // Draw highlighted match
            const matchText = nextMatch.match;
            const matchWidth = font.widthOfTextAtSize(matchText, fontSize);
            
            page.drawRectangle({
              x: currentX - 1,
              y: currentY - 2,
              width: matchWidth + 2,
              height: fontSize + 4,
              color: rgb(1, 1, 0),
              opacity: 0.3
            });
            
            page.drawText(matchText, {
              x: currentX,
              y: currentY,
              font,
              size: fontSize,
              color: rgb(1, 0, 0)
            });
            
            currentX += matchWidth;
            remainingLine = remainingLine.substring(matchStart + matchText.length);
          } else {
            // Draw remaining text
            page.drawText(remainingLine, {
              x: currentX,
              y: currentY,
              font,
              size: fontSize,
              color: rgb(0, 0, 0)
            });
            break;
          }
        }
      } else {
        // Draw normal line
        page.drawText(line, {
          x: 50,
          y: currentY,
          font,
          size: fontSize,
          color: rgb(0, 0, 0)
        });
      }
      
      currentY -= lineHeight;
      
      // Add new page if needed
      if (currentY < 50) {
        page = pdfDoc.addPage();
        currentY = page.getHeight() - 50;
      }
    }
    
    return await pdfDoc.save();
  } catch (error) {
    console.error('Error creating highlighted PDF:', error);
    throw error;
  }
}

// Helper to create masked PDF
async function createMaskedPDF(content, matches) {
  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Create masked content
    let maskedContent = content;
    matches.sort((a, b) => b.index - a.index); // Sort in reverse order to not affect indices
    
    for (const match of matches) {
      maskedContent = 
        maskedContent.slice(0, match.index) + 
        '*'.repeat(match.match.length) + 
        maskedContent.slice(match.index + match.match.length);
    }
    
    // Draw masked content
    const fontSize = 12;
    let currentY = page.getHeight() - 50;
    const lineHeight = fontSize * 1.2;
    
    const lines = maskedContent.split('\n');
    for (const line of lines) {
      if (line.trim() !== '') {
        page.drawText(line, {
          x: 50,
          y: currentY,
          font,
          size: fontSize,
          color: rgb(0, 0, 0)
        });
      }
      
      currentY -= lineHeight;
      
      if (currentY < 50) {
        page = pdfDoc.addPage();
        currentY = page.getHeight() - 50;
      }
    }
    
    return await pdfDoc.save();
  } catch (error) {
    console.error('Error creating masked PDF:', error);
    throw error;
  }
}

// Helper to create highlighted XLSX
function createHighlightedXLSX(filePath, content, matches) {
  try {
    const workbook = xlsx.readFile(filePath);
    const newWorkbook = xlsx.utils.book_new();

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      const newSheet = xlsx.utils.aoa_to_sheet(data);

      // Copy sheet properties
      if (sheet['!merges']) newSheet['!merges'] = sheet['!merges'];
      if (sheet['!cols']) newSheet['!cols'] = sheet['!cols'];
      if (sheet['!rows']) newSheet['!rows'] = sheet['!rows'];

      // Process cells
      Object.keys(newSheet).forEach(key => {
        if (key[0] === '!') return; // Skip special keys
        
        const cell = newSheet[key];
        if (!cell || !cell.v) return;

        const cellValue = String(cell.v);
        for (const match of matches) {
          if (cellValue.includes(match.match)) {
            cell.s = {
              fill: {
                patternType: 'solid',
                fgColor: { rgb: 'FFFF00' }
              },
              font: {
                color: { rgb: 'FF0000' }
              }
            };
            break;
          }
        }
      });

      xlsx.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
    });

    return xlsx.write(newWorkbook, {
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true
    });
  } catch (error) {
    console.error('Error creating highlighted XLSX:', error);
    throw error;
  }
}

// Helper to create masked XLSX
function createMaskedXLSX(filePath, content, matches) {
  try {
    const workbook = xlsx.readFile(filePath);
    const newWorkbook = xlsx.utils.book_new();

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      const newSheet = xlsx.utils.aoa_to_sheet(data);

      // Copy sheet properties
      if (sheet['!merges']) newSheet['!merges'] = sheet['!merges'];
      if (sheet['!cols']) newSheet['!cols'] = sheet['!cols'];
      if (sheet['!rows']) newSheet['!rows'] = sheet['!rows'];

      // Process cells
      Object.keys(newSheet).forEach(key => {
        if (key[0] === '!') return; // Skip special keys
        
        const cell = newSheet[key];
        if (!cell || !cell.v) return;

        let cellValue = String(cell.v);
        let masked = false;

        for (const match of matches) {
          if (cellValue.includes(match.match)) {
            cellValue = cellValue.replace(
              new RegExp(match.match, 'g'),
              '*'.repeat(match.match.length)
            );
            masked = true;
          }
        }

        if (masked) {
          cell.v = cellValue;
        }
      });

      xlsx.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
    });

    return xlsx.write(newWorkbook, {
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true
    });
  } catch (error) {
    console.error('Error creating masked XLSX:', error);
    throw error;
  }
}

// Helper to create highlighted DOCX
async function createHighlightedDOCX(content, matches) {
  try {
    console.log('Creating highlighted DOCX with content length:', content.length);
    console.log('Number of matches:', matches.length);
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: []
      }]
    });
    
    // Sort matches by position
    matches.sort((a, b) => a.index - b.index);
    
    let currentPos = 0;
    const paragraphs = [];
    
    // Process each match
    for (const match of matches) {
      // Add text before match
      if (match.index > currentPos) {
        const textBefore = content.slice(currentPos, match.index);
        const lines = textBefore.split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: line,
                  })
                ]
              })
            );
          }
        });
      }
      
      // Add highlighted match
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: match.match,
              color: "FF0000",
              highlight: "yellow"
            })
          ]
        })
      );
      
      currentPos = match.index + match.match.length;
    }
    
    // Add remaining text
    if (currentPos < content.length) {
      const remainingText = content.slice(currentPos);
      const lines = remainingText.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line,
                })
              ]
            })
          );
        }
      });
    }
    
    // Add all paragraphs to the document
    doc.addSection({
      children: paragraphs
    });
    
    console.log('Successfully created highlighted DOCX document');
    return await docx.Packer.toBuffer(doc);
  } catch (error) {
    console.error('Error creating highlighted DOCX:', error);
    throw error;
  }
}

// Helper to create masked DOCX
async function createMaskedDOCX(content, matches) {
  try {
    console.log('Creating masked DOCX with content length:', content.length);
    
    // Create masked content
    matches.sort((a, b) => b.index - a.index);
    let maskedContent = content;
    matches.forEach(match => {
      const beforeMatch = maskedContent.slice(0, match.index);
      const afterMatch = maskedContent.slice(match.index + match.match.length);
      maskedContent = beforeMatch + '*'.repeat(match.match.length) + afterMatch;
    });
    
    // Create document with masked content
    const doc = new Document({
      sections: [{
        properties: {},
        children: maskedContent.split('\n').map(line => 
          new Paragraph({
            children: [
              new TextRun({
                text: line
              })
            ]
          })
        )
      }]
    });
    
    console.log('Successfully created masked DOCX document');
    return await docx.Packer.toBuffer(doc);
  } catch (error) {
    console.error('Error creating masked DOCX:', error);
    throw error;
  }
}

// File upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  console.log("Received upload request");
  try {
    if (!req.file) {
      console.log("No file received");
      return res.status(400).json({ error: "No file uploaded" });
    }

    const processedDir = path.join(__dirname, 'processed');
    if (!fs.existsSync(processedDir)) {
      console.log("Creating processed directory");
      fs.mkdirSync(processedDir);
    }

    console.log("File received:", {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    });

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let documentContent = "";

    // Process file based on type
    console.log("Processing file with extension:", fileExtension);
    
    try {
      if (fileExtension === ".pdf") {
        console.log("Processing PDF file");
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        documentContent = pdfData.text;
      } else if (fileExtension === ".docx") {
        console.log("Processing Word document");
        const result = await mammoth.extractRawText({ path: filePath });
        if (result.messages.length > 0) {
          console.log("Mammoth messages:", result.messages);
        }
        documentContent = result.value;
        console.log("Extracted DOCX content length:", documentContent.length);
      } else if (fileExtension === ".xlsx") {
        console.log("Processing Excel file");
        try {
          const workbook = xlsx.readFile(filePath);
          let extractedText = '';
          let matches = [];

          // Process each sheet
          workbook.SheetNames.forEach(sheetName => {
            console.log(`Processing sheet: ${sheetName}`);
            const sheet = workbook.Sheets[sheetName];
            
            // Convert to array for easier processing
            const data = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });

            // Process each cell
            data.forEach((row, R) => {
              if (!Array.isArray(row)) return;

              row.forEach((cellValue, C) => {
                if (cellValue != null) {
                  const cellText = String(cellValue);
                  extractedText += cellText + ' ';

                  // Look for matches
                  sensitivePatterns.forEach(pattern => {
                    const regex = new RegExp(pattern.pattern, 'gi');
                    let match;
                    while ((match = regex.exec(cellText)) !== null) {
                      matches.push({
                        pattern: pattern.name,
                        match: match[0],
                        index: extractedText.length - cellText.length + match.index,
                        sheetName,
                        cell: xlsx.utils.encode_cell({ r: R, c: C }),
                        value: cellText
                      });
                    }
                  });
                }
              });
              extractedText += '\n';
            });
          });

          documentContent = extractedText;
          console.log(`Found ${matches.length} matches in Excel file`);
          console.log("Matches:", matches);
        } catch (error) {
          console.error("Error processing Excel file:", error);
          throw error;
        }
      } else {
        console.log("Unsupported file type:", fileExtension);
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: "Unsupported file type" });
      }
      
      console.log("Successfully extracted text from file");
    } catch (error) {
      console.error("Error extracting text from file:", error);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(500).json({ error: `Error processing file content: ${error.message}` });
    }

    // Find matches
    console.log("Searching for sensitive patterns in content");
    const matches = [];
    sensitivePatterns.forEach(pattern => {
      const regex = new RegExp(pattern.pattern, 'gi');
      let match;
      while ((match = regex.exec(documentContent)) !== null) {
        matches.push({
          pattern: pattern.name,
          match: match[0],
          index: match.index
        });
      }
    });
    console.log("Found matches:", matches.length);

    // Generate processed files based on input type
    const timestamp = Date.now();
    let highlightedFile, maskedFile;

    try {
      if (fileExtension === '.pdf') {
        highlightedFile = `highlighted-${timestamp}${fileExtension}`;
        maskedFile = `masked-${timestamp}${fileExtension}`;
        
        const highlightedPdf = await createHighlightedPDF(documentContent, matches);
        const maskedPdf = await createMaskedPDF(documentContent, matches);
        
        fs.writeFileSync(path.join(processedDir, highlightedFile), highlightedPdf);
        fs.writeFileSync(path.join(processedDir, maskedFile), maskedPdf);
      }
      else if (fileExtension === '.docx') {
        console.log("Creating DOCX output files");
        highlightedFile = `highlighted-${timestamp}${fileExtension}`;
        maskedFile = `masked-${timestamp}${fileExtension}`;
        
        const highlightedDocx = await createHighlightedDOCX(documentContent, matches);
        const maskedDocx = await createMaskedDOCX(documentContent, matches);
        
        fs.writeFileSync(path.join(processedDir, highlightedFile), highlightedDocx);
        fs.writeFileSync(path.join(processedDir, maskedFile), maskedDocx);
        console.log("Successfully created DOCX output files");
      }
      else if (fileExtension === '.xlsx') {
        console.log("Creating Excel output files");
        highlightedFile = `highlighted-${timestamp}${fileExtension}`;
        maskedFile = `masked-${timestamp}${fileExtension}`;
        
        console.log("Creating highlighted Excel file...");
        const highlightedXlsx = await createHighlightedXLSX(filePath, documentContent, matches);
        console.log("Writing highlighted Excel file...");
        fs.writeFileSync(path.join(processedDir, highlightedFile), highlightedXlsx);
        
        console.log("Creating masked Excel file...");
        const maskedXlsx = await createMaskedXLSX(filePath, documentContent, matches);
        console.log("Writing masked Excel file...");
        fs.writeFileSync(path.join(processedDir, maskedFile), maskedXlsx);
        
        console.log("Successfully created Excel output files");
      }
    } catch (error) {
      console.error("Error creating output files:", error);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(500).json({ error: `Error creating output files: ${error.message}` });
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);
    console.log("Cleaned up temporary file");

    // Return response
    const response = {
      message: "File processed successfully",
      matchedPatterns: matches,
      highlightedFile,
      maskedFile,
      originalFormat: fileExtension.slice(1) // Remove the dot
    };
    
    console.log("Sending response:", response);
    res.json(response);

  } catch (error) {
    console.error("Error processing file:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: `Error processing file: ${error.message}` });
  }
});

// View processed file
app.get("/view/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'processed', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  // Set appropriate content type based on file extension
  const ext = path.extname(filename).toLowerCase();
  let contentType = 'application/octet-stream';
  
  switch (ext) {
    case '.pdf':
      contentType = 'application/pdf';
      break;
    case '.docx':
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      break;
    case '.xlsx':
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      break;
  }
  
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
});

// Download processed file
app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'processed', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath);
});

const PORT = 8888;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
