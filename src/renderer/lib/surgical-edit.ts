export interface SurgicalEdit {
  type: 'insert' | 'replace' | 'delete' | 'full_replace' | 'create';
  file: string;
  startLine: number;
  endLine?: number;
  content?: string;
}

export interface ParsedEditResponse {
  edits: SurgicalEdit[];
  explanation: string;
}

export function parseSurgicalEdits(response: string): ParsedEditResponse {
  const edits: SurgicalEdit[] = [];
  let explanation = response;

  const fileBlockRegex = /<<<FILE\s+([^>]+)>>>([\s\S]*?)<<<END>>>/g;
  let fileMatch;
  
  while ((fileMatch = fileBlockRegex.exec(response)) !== null) {
    const [fullMatch, filename, fileContent] = fileMatch;
    explanation = explanation.replace(fullMatch, '').trim();
    
    edits.push({
      type: 'full_replace',
      file: filename.trim(),
      startLine: 1,
      content: fileContent.trim(),
    });
  }

  // Handle top-level CREATE blocks: <<<CREATE path/to/file.md>>>...<<<END>>>
  const createBlockRegex = /<<<CREATE\s+([^>]+)>>>([\s\S]*?)<<<END>>>/g;
  let createMatch;
  
  while ((createMatch = createBlockRegex.exec(response)) !== null) {
    const [fullMatch, filepath, fileContent] = createMatch;
    explanation = explanation.replace(fullMatch, '').trim();
    
    edits.push({
      type: 'create',
      file: filepath.trim(),
      startLine: 1,
      content: fileContent.trim(),
    });
  }

  const editBlockRegex = /<<<EDIT\s+([^>]+)>>>([\s\S]*?)<<<END>>>/g;
  let match;

  while ((match = editBlockRegex.exec(response)) !== null) {
    const [fullMatch, filename, editContent] = match;
    explanation = explanation.replace(fullMatch, '').trim();

    const lines = editContent.trim().split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('<<<DELETE')) {
        const rangeMatch = line.match(/<<<DELETE\s+lines?\s+(\d+)(?:-(\d+))?>>>/i);
        if (rangeMatch) {
          const startLine = parseInt(rangeMatch[1], 10);
          const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;
          edits.push({
            type: 'delete',
            file: filename.trim(),
            startLine,
            endLine,
          });
        }
        i++;
      } else if (line.startsWith('<<<INSERT')) {
        const insertMatch = line.match(/<<<INSERT\s+(?:after\s+)?line\s+(\d+)>>>/i);
        if (insertMatch) {
          const afterLine = parseInt(insertMatch[1], 10);
          const contentLines: string[] = [];
          i++;
          while (i < lines.length && !lines[i].startsWith('<<<')) {
            contentLines.push(lines[i]);
            i++;
          }
          edits.push({
            type: 'insert',
            file: filename.trim(),
            startLine: afterLine + 1,
            content: contentLines.join('\n'),
          });
        } else {
          i++;
        }
      } else if (line.startsWith('<<<REPLACE')) {
        const replaceMatch = line.match(/<<<REPLACE\s+lines?\s+(\d+)(?:-(\d+))?>>>/i);
        if (replaceMatch) {
          const startLine = parseInt(replaceMatch[1], 10);
          const endLine = replaceMatch[2] ? parseInt(replaceMatch[2], 10) : startLine;
          const contentLines: string[] = [];
          i++;
          while (i < lines.length && !lines[i].startsWith('<<<')) {
            contentLines.push(lines[i]);
            i++;
          }
          edits.push({
            type: 'replace',
            file: filename.trim(),
            startLine,
            endLine,
            content: contentLines.join('\n'),
          });
        } else {
          i++;
        }
      } else if (line.startsWith('<<<CREATE')) {
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('<<<')) {
          contentLines.push(lines[i]);
          i++;
        }
        edits.push({
          type: 'create',
          file: filename.trim(),
          startLine: 1,
          content: contentLines.join('\n'),
        });
      } else {
        i++;
      }
    }
  }

  return { edits, explanation };
}

export function applySurgicalEdit(
  originalContent: string,
  edit: SurgicalEdit
): string {
  const lines = originalContent.split('\n');

  switch (edit.type) {
    case 'full_replace':
    case 'create': {
      return edit.content || '';
    }
    case 'delete': {
      const startIdx = edit.startLine - 1;
      const endIdx = (edit.endLine || edit.startLine) - 1;
      lines.splice(startIdx, endIdx - startIdx + 1);
      break;
    }
    case 'insert': {
      const insertIdx = edit.startLine - 1;
      const newLines = edit.content?.split('\n') || [];
      lines.splice(insertIdx, 0, ...newLines);
      break;
    }
    case 'replace': {
      const startIdx = edit.startLine - 1;
      const endIdx = (edit.endLine || edit.startLine) - 1;
      const newLines = edit.content?.split('\n') || [];
      lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
      break;
    }
  }

  return lines.join('\n');
}

export function applyMultipleEdits(
  originalContent: string,
  edits: SurgicalEdit[]
): string {
  const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

  let result = originalContent;
  for (const edit of sortedEdits) {
    result = applySurgicalEdit(result, edit);
  }

  return result;
}

export function generateDiff(
  original: string,
  modified: string,
  filename: string
): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [];
  diff.push(`--- a/${filename}`);
  diff.push(`+++ b/${filename}`);

  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < modifiedLines.length) {
    if (i < originalLines.length && j < modifiedLines.length) {
      if (originalLines[i] === modifiedLines[j]) {
        diff.push(` ${originalLines[i]}`);
        i++;
        j++;
      } else {
        diff.push(`-${originalLines[i]}`);
        diff.push(`+${modifiedLines[j]}`);
        i++;
        j++;
      }
    } else if (i < originalLines.length) {
      diff.push(`-${originalLines[i]}`);
      i++;
    } else {
      diff.push(`+${modifiedLines[j]}`);
      j++;
    }
  }

  return diff.join('\n');
}
