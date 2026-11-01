cmake_minimum_required(VERSION 3.16)
project(ryong_firmware_host_core C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
enable_testing()

add_library(ryong_core STATIC src/ryong_core.c)
target_include_directories(ryong_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(MSVC)
  target_compile_options(ryong_core PRIVATE /W4)
else()
  target_compile_options(ryong_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(ryong_core_tests tests/test_core.c)
target_link_libraries(ryong_core_tests PRIVATE ryong_core)
add_test(NAME ryong_core_tests COMMAND ryong_core_tests)
