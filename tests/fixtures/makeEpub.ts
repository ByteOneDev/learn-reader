import { strToU8, zipSync } from 'fflate'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Construit un petit EPUB en mémoire. `version` 3 utilise nav.xhtml, 2 utilise toc.ncx. */
export function makeEpub(version: 2 | 3 = 3): Uint8Array {
  const chapter = (n: number, body: string): string =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C${n}</title><link rel="stylesheet" href="../style.css"/><style>p{color:red}</style></head><body>${body}</body></html>`
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    ),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Une brève histoire des réseaux</dc:title>
    <dc:creator>Inès Moreau</dc:creator>
    <dc:language>fr</dc:language>
    ${version === 2 ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>
  <manifest>
    ${version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'}
    <item id="cover-img" href="images/cover.png" media-type="image/png" ${version === 3 ? 'properties="cover-image"' : ''}/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine${version === 2 ? ' toc="ncx"' : ''}>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">Le temps des relais</a><ol><li><a href="text/ch1.xhtml#codes">Les codes</a></li></ol></li><li><a href="text/ch2.xhtml">Naissance des protocoles</a></li></ol></nav></body></html>'
    ),
    'OEBPS/toc.ncx': strToU8(
      '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Le temps des relais</text></navLabel><content src="text/ch1.xhtml"/><navPoint id="n1b"><navLabel><text>Les codes</text></navLabel><content src="text/ch1.xhtml#codes"/></navPoint></navPoint><navPoint id="n2"><navLabel><text>Naissance des protocoles</text></navLabel><content src="text/ch2.xhtml"/></navPoint></navMap></ncx>'
    ),
    'OEBPS/images/cover.png': PNG,
    'OEBPS/text/ch1.xhtml': strToU8(
      chapter(
        1,
        '<h1>Le temps des relais</h1><p>Les tours Chappe relayaient des signaux.</p><img src="../images/cover.png" alt=""/><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/cover.png"/></svg><h2 id="codes">Les codes</h2><p>Voir <a href="ch2.xhtml#tcp">TCP</a> et <a href="#codes">plus haut</a>, ou <a href="https://fr.wikipedia.org/wiki/Chappe">Wikipédia</a>.</p><script>alert(1)</script>'
      )
    ),
    'OEBPS/text/ch2.xhtml': strToU8(chapter(2, '<h1>Naissance des protocoles</h1><p id="tcp">TCP garantit la livraison des paquets.</p>')),
    'OEBPS/text/notes.xhtml': strToU8(chapter(3, '<p>Notes</p>'))
  }
  return zipSync(files)
}
