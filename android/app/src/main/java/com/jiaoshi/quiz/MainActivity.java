package com.jiaoshi.quiz;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 关键：registerPlugin 必须在 super.onCreate() 之前调用。
        // BridgeActivity.onCreate 内部会调用 this.load() 创建 Bridge，
        // 如果在 super 之后才注册，Bridge 已经创建完毕，插件永远注册不上，
        // JS 调用时就会报 "Unable to find plugin UpdateChecker"。
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
