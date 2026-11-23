# Changelog

## MCP App Server 1.11.0 (23 November 2026)

Mermaid, PlantUML and CSV become editable draw.io diagrams. Blog post: [Mermaid, PlantUML and CSV become editable draw.io diagrams in your AI assistant](https://www.drawio.com/blog/mcp-mermaid-plantuml-csv/).

- `create_diagram` takes PlantUML and draw.io CSV, next to draw.io XML and Mermaid ([#116](https://github.com/jgraph/drawio-mcp/pull/116)).
- These types are converted on the server into editable draw.io shapes, laid out and styled in the calm theme, with the colors the source sets ([#121](https://github.com/jgraph/drawio-mcp/pull/121)):
  - Mermaid flowcharts (`flowchart`, `graph`, `flowchart-elk`), ER diagrams and sequence diagrams
  - PlantUML sequence diagrams, and activity diagrams in the new syntax
  - draw.io CSV with the tree, flow and `none` layouts; each row keeps its columns as shape data
- The model gets the converted diagram back as draw.io XML, with a note on what was converted and a list of what isn't drawn exactly as written.
- A syntax error comes back with its line, what is wrong and how to fix it. A misspelled Mermaid header is an error too, where the viewer drew an empty frame before.
- Other types are converted in the viewer by draw.io's own converters, as before, and the model gets a note that says so: the other Mermaid types, the other PlantUML types, and CSV with `# list`, `# container`, the `circle` layout or a custom layout.
- Clients that don't show the app get a link that opens the converted diagram in draw.io. For PlantUML sequence and activity diagrams that link is new.
- The viewer shows the conversion while the source is still being written.
- A Mermaid flowchart with `postLayout: "elk"` is laid out again with ELK in the viewer. The other conversions have their own layout and ignore `postLayout`.
- Self-hosted servers: `DRAWIO_CONVERT=off` leaves all three formats to the viewer's converters; a comma list (`mermaid,csv`) converts only the formats it names.
- The MCP Registry entry (`io.draw/mcp`) and the plugin directory listing for ChatGPT and Codex name Mermaid, PlantUML and CSV. The registry entry also lists the tool server, `@drawio/mcp` 1.13.1 on npm ([#117](https://github.com/jgraph/drawio-mcp/pull/117)).
- The viewer's Download menu saves images as `diagram.drawio.png` and `diagram.drawio.svg`, the names draw.io gives images that carry the diagram and open for editing ([#125](https://github.com/jgraph/drawio-mcp/pull/125)).
- Self-hosted servers (Node and the `jgraph/drawio-mcp` Docker image) get an optional bearer token (`AUTH_TOKEN` or `AUTH_TOKEN_FILE`, off by default), an `Origin` check against DNS rebinding, and a startup banner that states the protection. Browser clients on an origin other than localhost now need `ALLOWED_ORIGINS`. The Docker examples publish the port on `127.0.0.1`. The hosted endpoint is unchanged ([#128](https://github.com/jgraph/drawio-mcp/pull/128)).
