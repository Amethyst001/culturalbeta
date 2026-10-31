# desk/logos

One PNG per priced ticker, fetched once by `scripts/fetch-logos.mjs` (source order:
Financial Modeling Prep → Parqet → CompaniesMarketCap; a file is accepted only if it is
a real PNG above a size floor, so an HTML error page or a 1×1 placeholder is rejected
rather than shipped).

These are third-party trademarks used solely to identify the company a row is about.
They are not Qloo data and carry no Qloo response. The desk renders a monogram
underneath every image, so a missing or blocked logo degrades to type.
