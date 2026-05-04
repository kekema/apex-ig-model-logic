# apex-ig-model-logic
Enables an application logic layer on top of IG Model. Provides event handlers and an abstracted API with application-level semantics.

This plugin can be helpful when you make use of IG's and want to delegate application logic as much as possible to the model layer. When making use of APEX model, you will notice:
- model notifications are like messaging deltas from the model to the view(s). They serve infrastructure rather than application-level semantics: 'set', 'addData', 'revert', etc: they are instructions to the view(s). 
- when making use of the model API, you get into details like record- and field metadata.

To make implementing application logic in the model layer much more convenient, the plugin offers:
- 'onFieldChange', 'onEvaluateRecords', 'onSetAggregateValue', 'onInitCalcValue' and 'onInitCheckCallback' event handlers
- a high-level API

Usage: <br/>
Page - Function and Global Variable Declaration:

````
$(function(){
    lib4x.ig.modelLogic.registerHandlers('ig_static_id', {
        onInitCalcValue: function(initCtx)
        {

        },
        onInitCheckCallback: function(initCtx)
        {

        },          
        onEvaluateRecord: function(ctx) 
        {

        },
        onFieldChange: function(ctx)
        {
                  
        },
        onSetAggregateValue: function(ctx)
        {

        }
    });
});
````

