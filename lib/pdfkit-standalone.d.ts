// pdfkit ships a precompiled browserify bundle that inlines its AFM font
// metrics so it survives Turbopack/webpack bundling (no runtime __dirname
// FS lookups). @types/pdfkit only ships types for the regular root entry,
// so we point the standalone subpath at the same type to keep tsc happy.
declare module 'pdfkit/js/pdfkit.standalone' {
  import PDFDocument = require('pdfkit')
  export default PDFDocument
}
