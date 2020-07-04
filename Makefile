SOURCES = extension.js
METADATA = package.json package-lock.json LICENSE README.md CHANGELOG.md

package: $(SOURCES) $(METADATA)
	npx vsce package .
