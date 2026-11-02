"""Compile the actual bond-owner adapter; simulate reboot at each persistent write."""
from pathlib import Path
import os,subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
HEADER=r'''
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <errno.h>
#define ZMK_BLE_PROFILE_COUNT 5
#define CONFIG_ZMK_CUSTOM_SETTINGS_VALUE_MAX_SIZE 32
#define K_FOREVER 0
#define K_MUTEX_DEFINE(name) int name
#define k_mutex_lock(lock, timeout) ((void)(lock))
#define k_mutex_unlock(lock) ((void)(lock))
#define BUILD_ASSERT(x) _Static_assert(x, #x)
#define ZMK_CUSTOM_SETTING_VALUE_TYPE_BYTES 1
#define ZMK_CUSTOM_SETTING_VALUE_TYPE_INT32 2
#define ZMK_CUSTOM_SETTING_CONFIDENTIALITY_DEVICE_PRIVATE 0
#define ZMK_CUSTOM_SETTING_PERMISSION_SECURE 1
#define ZMK_CUSTOM_SETTING_NO_CONSTRAINT 0
#define ZMK_CUSTOM_SETTING_WRITE_MODE_PERSIST 1
#define ZMK_CUSTOM_SETTING_ARRAY_DEFINE(name,sub,key,type,max,count,defs,conf,r,w,constraint) \
 static const void *name __attribute__((unused)) = defs
struct zmk_custom_setting {int kind;int index;};
struct zmk_custom_setting_value {int type;size_t size;uint8_t bytes_value[32];int32_t int32_value;};
typedef struct {uint8_t type;uint8_t address[6];} bt_addr_le_t;
bt_addr_le_t *zmk_ble_profile_address(uint8_t);
const struct zmk_custom_setting *zmk_custom_setting_find_array_element(const char *,const char *,uint8_t);
int zmk_custom_setting_read(const struct zmk_custom_setting *,struct zmk_custom_setting_value *);
int zmk_custom_setting_write(const struct zmk_custom_setting *,const struct zmk_custom_setting_value *,int);
int zmk_custom_setting_read_array_by_key(const char *,const char *,uint32_t,struct zmk_custom_setting_value *);
int zmk_custom_setting_write_array_by_key(const char *,const char *,uint32_t,const struct zmk_custom_setting_value *,int);

'''
HARNESS=r'''
#include <assert.h>
#include <stdio.h>
#include "adapter.c"
static struct zmk_custom_setting settings[3][5];
static struct zmk_custom_setting_value ram[3][5],flash[3][5];
static bt_addr_le_t peers[5];
static int writes,fail_at;
bt_addr_le_t *zmk_ble_profile_address(uint8_t i){return i<5?&peers[i]:NULL;}
const struct zmk_custom_setting *zmk_custom_setting_find_array_element(const char *sub,const char *key,uint8_t i){
 (void)sub;if(i>=5)return NULL;int k=!strcmp(key,"bond_owner_v1")?0:!strcmp(key,"ble_override")?1:2;return &settings[k][i];
}
int zmk_custom_setting_read(const struct zmk_custom_setting *s,struct zmk_custom_setting_value *v){*v=ram[s->kind][s->index];return 0;}
int zmk_custom_setting_write(const struct zmk_custom_setting *s,const struct zmk_custom_setting_value *v,int mode){
 assert(mode==1);if(++writes==fail_at)return -EIO;ram[s->kind][s->index]=*v;flash[s->kind][s->index]=*v;return 0;
}
int zmk_custom_setting_read_array_by_key(const char *sub,const char *key,uint32_t i,struct zmk_custom_setting_value *v){
 const struct zmk_custom_setting *s=zmk_custom_setting_find_array_element(sub,key,i);return s?zmk_custom_setting_read(s,v):-ENODEV;
}
int zmk_custom_setting_write_array_by_key(const char *sub,const char *key,uint32_t i,const struct zmk_custom_setting_value *v,int mode){
 const struct zmk_custom_setting *s=zmk_custom_setting_find_array_element(sub,key,i);return s?zmk_custom_setting_write(s,v,mode):-ENODEV;
}
static void setup(void){
 memset(ram,0,sizeof ram);memset(flash,0,sizeof flash);memset(peers,0,sizeof peers);memset(reset_pending,0,sizeof reset_pending);
 writes=0;fail_at=0;
 for(int k=0;k<3;k++)for(int i=0;i<5;i++){settings[k][i]=(struct zmk_custom_setting){k,i};ram[k][i].type=k?2:1;}
 for(int i=0;i<5;i++)peers[i].address[0]=i+1;
 memcpy(flash,ram,sizeof flash);
}
int main(void){
 setup();assert(ryong_host_guard_profile(0)==0);assert(writes==3);
 assert(ryong_host_take_reset(0));assert(!ryong_host_take_reset(0));
 assert(ryong_host_guard_profile(0)==0&&writes==3);
 ram[1][0].int32_value=2;ram[2][0].int32_value=4;
 memcpy(flash,ram,sizeof flash);
 assert(ryong_host_guard_profile(0)==0&&ram[1][0].int32_value==2);
 peers[0].address[0]=99;
 assert(ryong_host_guard_profile(0)==0);
 assert(ram[1][0].int32_value==0&&ram[2][0].int32_value==0);
 assert(ryong_host_take_reset(0));assert(ram[0][1].size==0);
 assert(ryong_host_guard_profile(5)==-EINVAL);
 for(int n=1;n<=3;n++){
  setup();assert(ryong_host_guard_profile(0)==0);
  ram[1][0].int32_value=2;ram[2][0].int32_value=4;memcpy(flash,ram,sizeof flash);
  peers[0].address[0]=99;writes=0;fail_at=n;
  assert(ryong_host_guard_profile(0)==-EIO);
  assert(flash[0][0].bytes_value[1]!=99);
  memcpy(ram,flash,sizeof ram);writes=0;fail_at=0;
  assert(ryong_host_guard_profile(0)==0);
  assert(ram[1][0].int32_value==0&&ram[2][0].int32_value==0);
  assert(ram[0][0].bytes_value[1]==99);
 }
 puts("Actual bond adapter: pairing identity, profile isolation, no repeated writes, three reboot/failure points passed");
}
'''
class HostBond(unittest.TestCase):
 def test_actual_adapter(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)
   (p/'shim.h').write_text(HEADER)
   for name in ['zephyr/kernel.h','zephyr/bluetooth/addr.h','cormoran/zmk/custom_settings.h','zmk/ble.h']:
    h=p/name;h.parent.mkdir(parents=True,exist_ok=True);h.write_text('#include "shim.h"\n')
   (p/'adapter.c').write_bytes((ROOT/'modules/ryong-host-layout/src/host_bond.c').read_bytes())
   (p/'test.c').write_text(HARNESS)
   subprocess.run([os.environ.get('CC','cc'),'-std=c11','-Wall','-Wextra','-Werror','-I'+str(p),'-I'+str(ROOT/'modules/ryong-host-layout/include'),str(p/'test.c'),'-o',str(p/'test')],check=True,capture_output=True)
   subprocess.run([str(p/'test')],check=True,capture_output=True)
if __name__=='__main__':unittest.main()
