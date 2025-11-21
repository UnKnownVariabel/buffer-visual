
#include <stdio.h>
#include <string.h>

void show_secret() {
  char encrypted[] = {
    0x37, 0xae, 0xef, 0x1a, 0xc8, 0xc9, 0xb9, 0x12, 
    0xcc, 0x25, 0x5a, 0x5f, 0x83, 0xc5, 0x08, 0x6f, 
    0x8e, 0x1a, 0x3b, 0x09, 0x29, 0x58
  };  
  char key[] = {
    0x51, 0xc2, 0x8e, 0x7d, 0xb3, 0xbb, 0xdc, 0x66, 
    0xb9, 0x57, 0x34, 0x00, 0xec, 0xb3, 0x6d, 0x1d, 
    0xfc, 0x73, 0x5f, 0x6c, 0x54, 0x52
  };
  for(int i = 0; i < 23; i++) {
    encrypted[i] = encrypted[i] ^ key[i];
  }
  printf(encrypted);
}

void reverse(char *text) {
  char buffer[16];
  strcpy(buffer, text);
  int length; 
  for(length = 0; length < 19 && buffer[length] != 0; length++);

  for(int i = 0; i < length / 2; i++) {
    char temp = buffer[i];
    buffer[i] = buffer[length - 1 - i];
    buffer[length - 1 - i] = temp;
  }
  printf("%s", buffer);
}

  

int main(int argc, char *argv[]) {
  reverse(argv[1]);
  return 0;
}
