import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function findMainFunction(node) {
  if (!node) return null;
  if (node.type === 'function_definition') {
    const declarator = node.namedChildren.find(c => c.type === 'function_declarator');
    if (declarator) {
      const identifier = declarator.namedChildren.find(c => c.type === 'identifier');
      if (identifier && identifier.text === 'main') {
        return node;
      }
    }
  }
  for (const child of node.namedChildren) {
    const mainFunction = findMainFunction(child);
    if (mainFunction) {
      return mainFunction;
    }
  }
  return null;
}

function App() {
  const [cCode, setCCode] = useState('');
  const [argument, setArgument] = useState('hello');
  const [stack, setStack] = useState([]);
  const [overflowedIndices, setOverflowedIndices] = useState([]);
  const [tree, setTree] = useState(null);
  const [mainFunction, setMainFunction] = useState(null);
  const [isParserInitialized, setIsParserInitialized] = useState(false);
  const parserRef = useRef(null);
  const initedRef = useRef(false);

  // New state for file management
  const [fileList, setFileList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [assemblyCode, setAssemblyCode] = useState('');

  useEffect(() => {
    let mounted = true;
    
    const initParser = async () => {
      try {
        const TreeSitterModule = await import('web-tree-sitter');
        
        if (!initedRef.current) {
          await TreeSitterModule.Parser.init();
          initedRef.current = true;
        }
        
        if (!mounted) return;
        
        const parser = new TreeSitterModule.Parser();
        const C = await TreeSitterModule.Language.load(`${process.env.PUBLIC_URL}/tree-sitter-c.wasm`);
        
        parser.setLanguage(C);
        parserRef.current = parser;
        setIsParserInitialized(true);
        
      } catch (err) {
        console.error('Failed to initialize parser:', err);
      }
    };
    
    initParser();
    
    return () => {
      mounted = false;
      if (parserRef.current) {
        try {
          parserRef.current.delete();
          parserRef.current = null;
        } catch (e) {
          console.error('Error deleting parser:', e);
        }
      }
    };
  }, []);

  // New useEffect to fetch file list and initial file
  useEffect(() => {
    // Automatically find example files from the public/examples directory
    const examples = ['hello_world.c', 'password.c']; 
    setFileList(examples);
    if (examples.length > 0) {
      setSelectedFile(examples[0]); // Automatically select the first file
    }
  }, []);

  // New useEffect to load file content when selectedFile changes
  useEffect(() => {
    if (selectedFile) {
      let assemblyFileName = '';
      const fetchFileContent = async () => {
        try {
          // Fetch C code
          const cResponse = await fetch(`${process.env.PUBLIC_URL}/examples/${selectedFile}`);
          const cText = await cResponse.text();
          setCCode(cText);

          // Fetch assembly code
          assemblyFileName = selectedFile.replace('.c', '.bin');
          const assemblyResponse = await fetch(`${process.env.PUBLIC_URL}/examples/${assemblyFileName}`);
          const assemblyBlob = await assemblyResponse.blob();
          setAssemblyCode(assemblyBlob);
        } catch (error) {
          console.error(`Failed to load file ${selectedFile}:`, error);
          setCCode(`Error loading ${selectedFile}.`);
          setAssemblyCode(null);
        }
      };
      fetchFileContent();
    }
  }, [selectedFile]);

  useEffect(() => {
    if (isParserInitialized && cCode) {
      try {
        if (tree) {
          tree.delete();
        }
        
        const newTree = parserRef.current.parse(cCode);
        setTree(newTree);
      } catch (err) {
        console.error('Failed to parse code:', err);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cCode, isParserInitialized]);

  useEffect(() => {
    if (!tree) return;
    const main = findMainFunction(tree.rootNode);
    setMainFunction(main);
  }, [tree]);

  useEffect(() => {
    if (!mainFunction) {
      setStack([]);
      return;
    }

    let addressCounter = 0x7fffffffeff0;
    const newStack = [];

    const compoundStatement = mainFunction.namedChildren.find(c => c.type === 'compound_statement');
    if (compoundStatement) {
      // Add return pointer FIRST (it goes at the bottom = lowest address)
      newStack.push({ name: 'return pointer', value: '0x4005e7', address: `0x${(addressCounter -= 8).toString(16)}` });

      // Then add variables in REVERSE order (last declared = lowest address)
      const declarations = compoundStatement.namedChildren.filter(c => c.type === 'declaration');
      for (let i = 0; i < declarations.length; i++) {
        const declaration = declarations[i];
        const declarator = declaration.namedChildren[1];
        if (declarator.type === 'array_declarator') {
          const identifier = declarator.namedChildren[0].text;
          const sizeNode = declarator.namedChildren.find(c => c.type === 'number_literal');
          const size = sizeNode ? parseInt(sizeNode.text) : 0;
          newStack.push({ name: identifier, value: ''.padEnd(size, '\0'), address: `0x${(addressCounter -= size).toString(16)}` });
        } else if (declarator.type === 'init_declarator') {
          const identifier = declarator.namedChildren[0].text;
          const value = declarator.namedChildren[1].text;
          newStack.push({ name: identifier, value: value, address: `0x${(addressCounter -= 4).toString(16)}` });
        } else {
          const identifier = declarator.text;
          newStack.push({ name: identifier, value: '', address: `0x${(addressCounter -= 4).toString(16)}` });
        }
      }

      const callExpressions = compoundStatement.namedChildren.filter(c => c.type === 'expression_statement' && c.namedChildren[0].type === 'call_expression');
      for (const call of callExpressions) {
        const identifier = call.namedChildren[0].namedChildren[0].text;
        if (identifier === 'strcpy') {
          const dest = call.namedChildren[0].namedChildren[1].namedChildren[0].text;
          const src = call.namedChildren[0].namedChildren[1].namedChildren[1].text;

          const destIndex = newStack.findIndex(item => item.name === dest);
          if (destIndex !== -1) {
            let newValue = '';
            if (src === 'argv[1]') {
              newValue = argument;
            }
            const bufferSize = newStack[destIndex].value.length;
            const overflow = newValue.length > bufferSize;
            
            newStack[destIndex].value = newValue.substring(0, bufferSize);
            
            const newOverflowedIndices = [];
            if (overflow) {
              let overflowValue = newValue.substring(bufferSize);
              let currentIndex = destIndex - 1;
              
              // Overflow goes backwards (towards lower indices = lower addresses)
              while (overflowValue.length > 0 && currentIndex >= 0) {
                const currentItem = newStack[currentIndex];
                const availableSpace = currentItem.value.length || 8;
                const valueToFill = overflowValue.substring(0, availableSpace);
                
                currentItem.value = valueToFill.padEnd(availableSpace, currentItem.value.substring(valueToFill.length) || '\0');
                
                for (let i = 0; i < valueToFill.length; i++) {
                  newOverflowedIndices.push({ itemIndex: currentIndex, charIndex: i });
                }
                
                overflowValue = overflowValue.substring(valueToFill.length);
                currentIndex--;
              }
            }
            setOverflowedIndices(newOverflowedIndices);
          }
        }
      }
    }

    setStack(newStack);
  }, [argument, mainFunction]);

  // Function to handle assembly download
  const handleDownloadAssembly = () => {
    if (!assemblyCode) return;
    const element = document.createElement('a');
    element.href = URL.createObjectURL(assemblyCode);
    element.download = selectedFile.replace('.c', ''); // Download with assembly file name
    document.body.appendChild(element); // Required for Firefox
    element.click();
    document.body.removeChild(element); // Clean up
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Stack Visualizer</h1>
      </header>
      <main className="app-main">
        <div className="controls-container">
          <div className="file-selection">
            <h2>Select C File</h2>
            <select onChange={(e) => setSelectedFile(e.target.value)} value={selectedFile || ''}>
              {fileList.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </div>
          <h2>C Code</h2>
          <textarea
            value={cCode}
            onChange={(e) => setCCode(e.target.value)}
            rows={15}
            className="code-input"
            readOnly // Make it read-only as it's loaded from file
          />
          <div className="argument-container">
            <h2>Argument (argv[1])</h2>
            <input
              type="text"
              value={argument}
              onChange={(e) => setArgument(e.target.value)}
              className="argument-input"
            />
          </div>
          <button onClick={handleDownloadAssembly} disabled={!assemblyCode}>
            Download Assembly
          </button>
        </div>
        <div className="stack-container">
          <h2>Stack (High → Low Address)</h2>
          <div className="stack-visualizer">
            {!mainFunction && cCode && <p>No main function found in the C code.</p>}
            {stack.map((item, index) => (
              <div key={index} className={`stack-item ${item.name === 'return pointer' ? 'return-pointer' : ''}`}>
                <span className="stack-address">{item.address}</span>
                <span className="stack-name">{item.name}</span>
                <span className="stack-value">
                  {item.value.split('').map((char, i) => (
                    <span 
                      key={i} 
                      className={`stack-char ${overflowedIndices.some(o => o.itemIndex === index && o.charIndex === i) ? 'overflow' : ''}`}
                    >
                      {char === '\0' ? '\\0' : char}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}





export default App;
