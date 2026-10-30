// Fillable AcroForm test doc: text fields, checkbox, dropdown, radio group.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const page = doc.addPage([612, 792])
const form = doc.getForm()
page.drawText('Application Form', { x: 72, y: 720, size: 22, font })
const label = (t, y) => page.drawText(t, { x: 72, y: y + 6, size: 12, font, color: rgb(0.2, 0.2, 0.2) })

label('Full name', 660)
form.createTextField('name').addToPage(page, { x: 180, y: 652, width: 300, height: 24 })
label('Email', 620)
form.createTextField('email').addToPage(page, { x: 180, y: 612, width: 300, height: 24 })
label('Country', 580)
const dd = form.createDropdown('country')
dd.addOptions(['China', 'Japan', 'USA'])
dd.addToPage(page, { x: 180, y: 572, width: 160, height: 24 })
label('Subscribe', 540)
form.createCheckBox('subscribe').addToPage(page, { x: 180, y: 536, width: 18, height: 18 })
label('Notes', 500)
const notes = form.createTextField('notes')
notes.enableMultiline()
notes.addToPage(page, { x: 180, y: 430, width: 300, height: 80 })

writeFileSync('public/samples/form.pdf', await doc.save())
console.log('written public/samples/form.pdf')
