#include <stdio.h>
#include <string.h>

int main(int argc, char *argv[]) {
  char buffer1[10];
  char buffer2[10];
  strcpy(buffer1, "c program");
  strcpy(buffer2, argv[1]);
  printf("hello %s\n", buffer2);
  printf("i am a %s\n", buffer1);
  return 0;
}
