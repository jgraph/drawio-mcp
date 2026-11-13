// The description of the semantic diagram tool, as the model reads it. Built
// from the types that are switched on, so a type is only offered once its
// layout is at least as good as the model placing the XML itself (judged
// blind on rendered images, see bench/README.md). Each server's tools test
// caps descriptions at 2048 characters.

const INTRO =
  "Creates and displays a draw.io diagram from a description of its content: you say what exists and how it connects, " +
  "the server lays it out, routes the lines and styles it (draw.io's calm colors). Never give coordinates, sizes or styles. " +
  "The result is the diagram's draw.io XML. To change the diagram, call this again with the whole changed description, " +
  "keeping the ids.\n\n" +
  "Arguments: type, title (optional), nodes [{id, label, …}], edges [{from, to, …}].";

const TYPES =
{
  er:
    "type \"er\" (database schemas): every node is a table {id, label, fields}, fields one string per column, the key first: " +
    "\"PK book_id\", \"FK author_id\", \"PK, FK book_id\", \"title\", optionally with a type (\"price: decimal\"). " +
    "Every edge is a relation {from, to, kind}: kind \"one-to-many\" from the referenced table to the table holding the " +
    "foreign key, \"one-to-one\" or \"many-to-many\". fromCard / toCard (\"1\", \"0..1\", \"1..*\", \"0..*\") set other " +
    "multiplicities; fromField / toField name the columns when a foreign key's name doesn't say which table it " +
    "references. Relations show their multiplicities, not labels; add a junction table for many-to-many with attributes."
};

/**
 * @param {string[]} types - the types to offer, in this order
 * @returns {string}
 */
export function describeTool(types)
{
  const parts = [INTRO];

  for (const t of types)
  {
    if (TYPES[t] != null)
    {
      parts.push(TYPES[t]);
    }
  }

  return parts.join("\n\n");
}
