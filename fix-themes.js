const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'apps/web/src');

const replacements = [
  // Backgrounds
  { regex: /(?<!dark:)(?<!bg-white )(?<!bg-slate-50 )bg-vault-900/g, replacement: 'bg-white dark:bg-vault-900' },
  { regex: /(?<!dark:)(?<!bg-white )(?<!bg-slate-50 )bg-vault-950/g, replacement: 'bg-white dark:bg-vault-950' },
  { regex: /(?<!dark:)(?<!bg-slate-50 )bg-vault-800\/50/g, replacement: 'bg-slate-50 dark:bg-vault-800/50' },
  { regex: /(?<!dark:)(?<!bg-slate-100 )bg-vault-800(?!(\/|0))/g, replacement: 'bg-slate-100 dark:bg-vault-800' },
  { regex: /(?<!dark:)(?<!bg-blue-600 )bg-vault-500/g, replacement: 'bg-blue-600 dark:bg-vault-500' },
  { regex: /(?<!dark:)(?<!hover:bg-blue-700 )hover:bg-vault-400/g, replacement: 'hover:bg-blue-700 dark:hover:bg-vault-400' },
  { regex: /(?<!dark:)(?<!hover:bg-slate-50\/50 )hover:bg-vault-800\/30/g, replacement: 'hover:bg-slate-50/50 dark:hover:bg-vault-800/30' },
  { regex: /(?<!dark:)(?<!bg-slate-700 )bg-vault-700/g, replacement: 'bg-slate-700 dark:bg-vault-700' },

  // Borders
  { regex: /(?<!dark:)(?<!border-slate-200 )border-vault-800/g, replacement: 'border-slate-200 dark:border-vault-800' },
  { regex: /(?<!dark:)(?<!border-slate-300 )border-vault-700/g, replacement: 'border-slate-300 dark:border-vault-700' },
  { regex: /(?<!dark:)(?<!border-slate-400 )border-vault-600/g, replacement: 'border-slate-400 dark:border-vault-600' },
  { regex: /(?<!dark:)(?<!hover:border-slate-300 )hover:border-vault-700/g, replacement: 'hover:border-slate-300 dark:hover:border-vault-700' },

  // Text
  { regex: /(?<!dark:)(?<!text-slate-900 )(?<!text-slate-800 )text-white/g, replacement: 'text-slate-900 dark:text-white' },
  { regex: /(?<!dark:)(?<!text-slate-500 )text-vault-400/g, replacement: 'text-slate-500 dark:text-vault-400' },
  { regex: /(?<!dark:)(?<!text-slate-600 )text-vault-300/g, replacement: 'text-slate-600 dark:text-vault-300' },
  { regex: /(?<!dark:)(?<!text-slate-700 )text-vault-200/g, replacement: 'text-slate-700 dark:text-vault-200' },
  { regex: /(?<!dark:)(?<!text-slate-800 )text-vault-100/g, replacement: 'text-slate-800 dark:text-vault-100' },
  { regex: /(?<!dark:)(?<!text-slate-400 )text-vault-500/g, replacement: 'text-slate-500 dark:text-vault-500' },
  
  // Divide
  { regex: /(?<!dark:)(?<!divide-slate-100 )divide-vault-800/g, replacement: 'divide-slate-100 dark:divide-vault-800' }
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let newContent = content;
      
      // Let's handle the "text-white" carefully, as it's often used inside buttons which SHOULD remain white in light mode.
      // A safe way is to only replace text-white if we also replaced bg-vault-900 or bg-vault-950 in the same element.
      // But regex can't easily do that. Let's omit global text-white replacement and manually handle or just check if it's inside a class string.
      // Wait, if it's inside a button with bg-blue-600, it SHOULD be text-white!
      // So replacing all `text-white` with `text-slate-900 dark:text-white` will break buttons!
      // Let's REMOVE text-white from the global replacements, it's too risky.
      
      for (const { regex, replacement } of replacements) {
        if (regex.toString().includes('text-white')) continue;
        newContent = newContent.replace(regex, replacement);
      }
      
      // Special logic for text-white:
      // If a class string contains bg-white, replace text-white with text-slate-900 dark:text-white inside that class string.
      newContent = newContent.replace(/className="([^"]*)"/g, (match, classes) => {
        let newClasses = classes;
        
        // If it's a structural container that we just made white in light mode, text should be slate-900
        if (newClasses.includes('bg-white') || newClasses.includes('bg-slate-50')) {
          newClasses = newClasses.replace(/(?<!dark:)text-white/g, 'text-slate-900 dark:text-white');
        }
        
        return `className="${newClasses}"`;
      });

      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDirectory(srcDir);
console.log('Done!');
