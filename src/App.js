import React, { useState, useEffect, useRef } from 'react';

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
  const [cCode, setCCode] = useState(`#include <stdio.h>
#include <string.h>

int main(int argc, char *argv[]) {
  char buffer1[10];
  char buffer2[10];
  strcpy(buffer1, "c program");
  strcpy(buffer2, argv[1]);
  printf("hello %s\n", buffer2);
  printf("i am a %s\n", buffer1);
  return 0;
}`);
  const [argument, setArgument] = useState('hello');
  const [stack, setStack] = useState([]);
  const [overflowedIndices, setOverflowedIndices] = useState([]);
  const [tree, setTree] = useState(null);
  const [mainFunction, setMainFunction] = useState(null);
  const parserRef = useRef(null);
  const initedRef = useRef(false);

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
        const C = await TreeSitterModule.Language.load('/tree-sitter-c.wasm');
        
        parser.setLanguage(C);
        parserRef.current = parser;
        
        const newTree = parser.parse(cCode);
        setTree(newTree);
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

  useEffect(() => {
    if (parserRef.current && cCode) {
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
  }, [cCode]);

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

  return (
    <div style={{ fontFamily: 'monospace', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Stack Visualizer</h1>
      </header>
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <h2>C Code</h2>
          <textarea
            value={cCode}
            onChange={(e) => setCCode(e.target.value)}
            rows={15}
            style={{ width: '100%', fontFamily: 'monospace', padding: '10px', fontSize: '14px' }}
          />
          <div style={{ marginTop: '20px' }}>
            <h2>Argument (argv[1])</h2>
            <input
              type="text"
              value={argument}
              onChange={(e) => setArgument(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', padding: '10px', fontSize: '14px' }}
            />
          </div>
        </div>
        <div>
          <h2>Stack (High → Low Address)</h2>
          <div style={{ border: '1px solid #333', padding: '10px', backgroundColor: '#f5f5f5' }}>
            {!mainFunction && cCode && <p>No main function found in the C code.</p>}
            {stack.map((item, index) => (
              <div key={index} style={{ 
                display: 'grid', 
                gridTemplateColumns: '120px 150px 1fr', 
                gap: '10px',
                padding: '5px',
                borderBottom: '1px solid #ddd',
                backgroundColor: item.name === 'return pointer' ? '#ffebee' : 'white'
              }}>
                <span style={{ color: '#666' }}>{item.address}</span>
                <span style={{ fontWeight: 'bold' }}>{item.name}</span>
                <span style={{ fontFamily: 'monospace' }}>
                  {item.value.split('').map((char, i) => (
                    <span 
                      key={i} 
                      style={{ 
                        backgroundColor: overflowedIndices.some(o => o.itemIndex === index && o.charIndex === i) ? '#ff4444' : 'transparent',
                        color: overflowedIndices.some(o => o.itemIndex === index && o.charIndex === i) ? 'white' : 'black',
                        padding: '2px'
                      }}
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
