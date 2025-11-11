#include <stdio.h>
#include <string.h>

void show_secret() {
  printf("flag{***}");
}

int main(int argc, char *argv[]) {
  char password[10];
  char user_input[10];
  strcpy(password, "password");
  strcpy(user_input, argv[1]);
  if(strncmp(password, user_input, 10) == 0) {
    show_secret();
  }
  else {
    printf("wrong password");
  }
  return 0;
}
