/** Every committed migration's SQL, concatenated in folder order. */
export const committedMigrationSql = async () => {
  const directory = new URL('../migrations/', import.meta.url).pathname;
  const folders = [...new Bun.Glob('*/migration.sql').scanSync(directory)]
    .map((path) => path.split('/')[0]!)
    .sort();
  return (
    await Promise.all(
      folders.map((folder) =>
        Bun.file(`${directory}${folder}/migration.sql`).text(),
      ),
    )
  ).join('\n');
};
