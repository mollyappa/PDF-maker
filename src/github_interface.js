#!/usr/bin/env node
'use strict';
const fs = require("fs");
const path = require("path");
const md2pdf = require('./markdown-to-pdf');
const axios = require('axios');

const DEFAULT_THEME_FILE = '/styles/markdown.css';
const DEFAULT_HIGHLIGHT_FILE = '/styles/highlight.css';
const DEFAULT_TEMPLATE_FILE = '/template/template.html';
const RUNNER_DIR = '/github/workspace/';


function getRunnerInput(name, def, transformer = val => val) {
    let value = process.env['INPUT_' + name.toUpperCase()];

    return (value === undefined || value === '') ? def : transformer(value);
}

function getRunnerPath(file) {
    file = path.normalize(RUNNER_DIR + file);

    if (!file.startsWith(RUNNER_DIR)) throw `Cannot move outside of directory '${RUNNER_DIR}'`;

    return file;
}

function booleanTransformer(bool) {
    return bool === 'true';
}

// Process given input_path and set flag indicating if it is a directory or single file path
// getRunnerInput for input_dir is passed as the fallback value for backwards compatibility
let InputPath = getRunnerInput(
    'input_path',
    getRunnerInput('input_dir', '', getRunnerPath),
    getRunnerPath
);
let InputPathIsDir = false
try {
    InputPathIsDir = fs.lstatSync(InputPath).isDirectory();
} catch {
    throw `Given input path, ${InputPath}, was not found in filesystem!`;
}

if (InputPathIsDir) {
    InputPath += InputPath.endsWith("/") ? "" : "/"
}

// Other GitHub Action inputs that are needed for this program to run
const ImageImport = getRunnerInput('image_import', null);
const ImageDir = getRunnerInput('images_dir',
    InputPathIsDir ? InputPath : path.dirname(InputPath) + '/' +
        md2pdf.nullCoalescing(ImageImport, ''),
    getRunnerPath);

// Optional input, though recommended
let OutputDir = getRunnerInput('output_dir', 'built', getRunnerPath);
let OutputDirIsDir = false
try {
    OutputDirIsDir = fs.lstatSync(OutputDir).isDirectory();
} catch { }
if (!OutputDirIsDir) {
    OutputDir += OutputDir.endsWith("/") ? "" : "/"
    CreateOutputDirectory(OutputDir);
}

// Whether to also output a <filename>.html file, there is a bit of magic at the end to ensure that the value is a boolean
const build_html = getRunnerInput('build_html', false, booleanTransformer);

// Whether to also output a <filename>.pdf file, there is a bit of magic at the end to ensure that the value is a boolean
// This was requested in #36. No idea why...
const build_pdf = getRunnerInput('build_pdf', true, booleanTransformer);

// Custom CSS and HTML files for theming
const ThemeFile = getRunnerInput('theme', null, getRunnerPath);
const HighlightThemeFile = getRunnerInput('highlight_theme', DEFAULT_HIGHLIGHT_FILE, getRunnerPath);
const TemplateFile = getRunnerInput('template', DEFAULT_TEMPLATE_FILE, getRunnerPath);

// Whether to extend your custom CSS file with the default theme
const extend_default_theme = getRunnerInput('extend_default_theme', true, booleanTransformer);

// Table Of Contents settings
const table_of_contents = getRunnerInput('table_of_contents', false, booleanTransformer);


// CreateOutputDirectory creates the output directory if it doesn't exist
function CreateOutputDirectory(dirname) {
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname);
    }
}

// GetMarkdownFiles returns an array of only files ending in .md or .markdown
// NOTE: When a file name is the same, eg. happy.md and happy.markdown, only one file is
// outputted as it will be overwritten. This needs to be checked. (TODO:)
function GetMarkdownFiles(files) {
    return files.filter(function (filePath) {
        if (path.extname(filePath).match(/^(.md|.markdown)$/)) {
            return true;
        }
    });
}

// GetFileBody retrieves the file content as a string
function GetFileBody(file) {
    return md2pdf.getFileContent(
        (InputPathIsDir ? InputPath + file : InputPath)
    );
}



// BuildHTML outputs the HTML string to a file
function BuildHTML(result, file) {
    file = UpdateFileName(file, 'html');
    result.writeHTML(OutputDir + file);
    console.log('Built HTML file: ' + file);
}
/*
function getRepositoryName() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
        console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
        return null;
    }

    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
        console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
        return null;
    }

    const repositoryName = repoParts[1];
    return repositoryName;
}
*/

function getRepositoryName() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
      console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
      return null;
    }
  
    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
      console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
      return null;
    }
  
    const repositoryName = repoParts[1];
    return repositoryName;
  }
  
async function getLatestReleaseVersion() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
      console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
      return '0.0.0';
    }
  
    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
      console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
      return '0.0.0';
    }
  
    const owner = repoParts[0];
    const repo = repoParts[1];
  
    try {
        const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/tags`);
        const latestTagVersion = response.data[0].name;
        return latestTagVersion;
    } catch (error) {
        console.error('Error fetching latest release information:', error.message);
        return '0.0.0';
    }
}



function UpdateFileName(fileName, extension) {
    if (typeof fileName !== 'string' || (extension !== null && typeof extension !== 'string')) {
        throw new Error('Invalid input');
    }

    const parts = fileName.split('.');
    const currentExtension = parts.pop();

    if (extension !== null && extension !== '' && currentExtension.toLowerCase() !== extension.toLowerCase()) {
        parts.push(extension);
    }
    
    return parts.join('.');
}


async function BuildPDF(result, file) {
    const repositoryName =await getRepositoryName();
    const tagVersion =await getLatestReleaseVersion();
    const arbitrary_name =await getRunnerInput('output_name', repositoryName);
    const keep_original_name = await getRunnerInput('keep_original_name', false, booleanTransformer)
    console.log("Keep original name value: "+keep_original_name)
    if (keep_original_name===false){
    function generatePDFFileName(baseFileName, existingFiles) {
        let fileName = baseFileName;
        let index = 1;

        while (existingFiles.includes(fileName + '.pdf')) {
            fileName = `${baseFileName} (${index})`;
            index++;
        }

        return fileName + '.pdf';
    }

    let baseFileName = arbitrary_name + ' ' + tagVersion;
    console.log("Existing files: " +existingFiles) 
    let pdfFileName = generatePDFFileName(baseFileName, existingFiles);
    result.writePDF(OutputDir + pdfFileName);
    console.log('Built PDF file: ' + pdfFileName);
    existingFiles.push(pdfFileName);
    }
    else 
    {
        file = UpdateFileName(file, 'pdf');
        result.writePDF(OutputDir + file);
        console.log('Built PDF file: ' + file);
        
    }
    

    
}

/*
// BuildHTML outputs the HTML string to a file
function BuildHTML(result, file) {
    file = UpdateFileName(file, 'html');
    result.writeHTML(OutputDir + file);
    console.log('Built HTML file: ' + file);
}
*/


async function ConvertMarkdown(file) {
    console.log('Converting: ' + file);
    try {
        let result = await md.convert(GetFileBody(file));

        if (build_html === true) {
            BuildHTML(result, file);
        }

        if (build_pdf === true) {
            BuildPDF(result, file);
            console.log('Built PDF file: ' + file);
        }
    } catch (err) {
        throw `Trouble converting markdown files: ${err}`;
    }
}

// Assign the style and template files to strings for later manipulation
const style = (extend_default_theme ? md2pdf.getFileContent(DEFAULT_THEME_FILE) : '')
    + (ThemeFile === null ? '' : md2pdf.getFileContent(ThemeFile))
    + md2pdf.getFileContent(HighlightThemeFile);
const template = md2pdf.getFileContent(TemplateFile);

let md = new md2pdf({
    image_import: ImageImport,
    image_dir: ImageDir,

    style: style,
    template: template,

    table_of_contents: table_of_contents,
});
md.start();

let existingFiles = [];

if (InputPathIsDir) {
    // Handle case that user supplied path to directory of markdown files

    fs.readdir(InputPath, async function (err, files) {
        files = GetMarkdownFiles(files);
        if (files.length === 0) throw 'No markdown files found! Exiting.';
        existingFiles = files.map(file => path.basename(file));

        console.log('Markdown files found: ' + files.join(', '));        
        // Loop through each file converting it
        for (let file of files) {
            await ConvertMarkdown(file).catch(function (err) {
                throw ` Trouble converting markdown files: ${err}`;
            })
        }

        // Close the image server
        md.close();
    });
} else {
    // Handle case that user supplied path to one markdown file

    // This is wrapped in an anonymous function to allow async/await.
    // This could be abstracted into a standalone function easily in the future
    // but it is currently single-use so this seemed appropriate.
    (async () => {
        const files = GetMarkdownFiles([path.basename(InputPath)]);
        if (files.length === 0) throw 'No markdown file found! Exiting.';

        console.log('Markdown file found: ' + files, files[0]);

        // Convert the file
        await ConvertMarkdown(files[0]).catch(function (err) {
            throw ` Trouble converting markdown files: ${err}`;
        })

        // Close the image server
        md.close();
    })();
}