# apex-ig-model-logic
Enables an application logic layer on top of IG Model. Provides event handlers and an abstracted API with application-level semantics.

This plugin can be helpful when you make use of IG's and want to delegate application logic as much as possible to the model layer. When making use of APEX model, you will notice:
- model notifications are like messaging deltas from the model to the view(s). They serve infrastructure rather than application-level semantics. 'set', 'addData', 'revert', etc: they are instructions to the view(s). 
- when making use of the model API, you get into details like record- and field metadata.

To make implementing application logic in the model layer much more convenient, the plugin offers:
- 'onFieldChange', 'onEvaluateRecord', 'onSetAggregateValue', 'onInitCalcValue' and 'onInitCheckCallback' event handlers
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
<ins>onFieldChange</ins>: gets triggered when a field value of a record is changed. The ctx context object will have a whole set of util methods:
<p></p>
<img width="70%" height="70%" alt="image" src="https://github.com/user-attachments/assets/aeb205b6-cb11-4e4f-a0de-347141c9df91" />
</p>
<p>
Notice a method like 'setNativeValue' where you can use the native JavaScript value to set the value of a field, and where you have the 'suppressFieldChangeHandler' argument available.
</p>

<ins>onEvaluateRecord</ins>: gets triggered when a record is added to the model from the server data, or when a record is refreshed after being saved, or when a record is reverted, or when a record is inserted or copied, or when the editing of a record is finishing (apexendrecordedit). This event handler you can use for example when you want to conditionally highlight a column field. You can use the 'setFieldHighlight' method here.


<ins>onSetAggregateValue</ins>: gets triggered when an aggregate value is set from either an aggregate as defined in 'Column Initialization JavaScript Function', or when an aggregate is defined from 'Actions' menu.

<ins>onInitCalcValue</ins>
Example:
````
onInitCalcValue: function(initCtx)
{
    if (initCtx.columnName == 'LINETOTAL')
    {
        initCtx.setCalcValue('UNIT_PRICE', 'QUANTITY', function(calcCtx){
            let lineTotal = calcCtx.getNativeValue('UNIT_PRICE') * calcCtx.getNativeValue('QUANTITY');
            return isNaN(lineTotal) ? 0 : lineTotal;
        });
    }
}
````

