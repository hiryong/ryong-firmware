if(CONFIG_RYONG_HOST_LAYOUT)
  zephyr_include_directories(include)
  target_sources(app PRIVATE src/host_layout.c src/behavior_host_layout.c src/host_bond.c)
endif()
